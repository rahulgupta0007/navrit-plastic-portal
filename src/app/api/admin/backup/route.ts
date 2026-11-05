import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getSession } from "@/lib/auth";
import {
  createBackup,
  listBackups,
  resolveBackupPath,
  restoreBackup,
  verifyBackup,
  formatBytes,
} from "@/lib/backup";
import {
  createMigrationPackBuffer,
  getMigrationStatus,
  importDatabaseBuffer,
  importMigrationPackBuffer,
  listMigrationPacks,
  resolveMigrationPackPath,
  envSnapshotToDotEnv,
  buildEnvSnapshot,
} from "@/lib/migration-pack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function guard() {
  return getSession();
}

export async function GET(req: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const download = req.nextUrl.searchParams.get("download");
  if (download) {
    try {
      const full = resolveBackupPath(download);
      const check = verifyBackup(download);
      if (!check.ok) {
        return NextResponse.json({ error: "Checksum failed" }, { status: 400 });
      }
      const buf = fs.readFileSync(full);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${download}"`,
          "X-Checksum-SHA256": check.actual,
        },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Not found" },
        { status: 404 }
      );
    }
  }

  const migrationDownload = req.nextUrl.searchParams.get("migrationDownload");
  if (migrationDownload) {
    try {
      const full = resolveMigrationPackPath(migrationDownload);
      const buf = fs.readFileSync(full);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${pathBasename(migrationDownload)}"`,
        },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Not found" },
        { status: 404 }
      );
    }
  }

  if (req.nextUrl.searchParams.get("status") === "1") {
    return NextResponse.json(getMigrationStatus());
  }

  if (req.nextUrl.searchParams.get("envTemplate") === "1") {
    // Redacted template (no secret values) for safe sharing
    const text = envSnapshotToDotEnv(buildEnvSnapshot(false), { redactSecrets: true });
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="railway-variables.template.env"',
      },
    });
  }

  const backups = listBackups().map((b) => ({
    ...b,
    sizeLabel: formatBytes(b.size),
  }));
  return NextResponse.json({
    backups,
    migrationPacks: listMigrationPacks(),
    status: getMigrationStatus(),
  });
}

function pathBasename(name: string) {
  return String(name).split(/[/\\]/).pop() || name;
}

export async function POST(req: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  // Multipart import (DB file or migration zip)
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      const confirm = String(form.get("confirm") || "");
      if (confirm !== "RESTORE") {
        return NextResponse.json(
          { error: 'Type RESTORE in the confirm box to import (this replaces live data)' },
          { status: 400 }
        );
      }
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "Choose a .db or .zip file to import" }, { status: 400 });
      }
      const blob = file as File;
      const ab = await blob.arrayBuffer();
      const buf = Buffer.from(ab);
      const name = (blob.name || "").toLowerCase();

      if (name.endsWith(".zip")) {
        const result = await importMigrationPackBuffer(buf);
        return NextResponse.json({
          kind: "migration-pack",
          ...result,
          message:
            "Database imported. Paste railway-variables.env into the new Railway Variables if needed, then redeploy/restart.",
        });
      }

      if (name.endsWith(".db") || buf.subarray(0, 15).toString("utf8") === "SQLite format 3") {
        const result = importDatabaseBuffer(buf, "upload");
        return NextResponse.json({
          kind: "database",
          ...result,
          message: "Database imported. Redeploy/restart the app so connections reload.",
        });
      }

      return NextResponse.json(
        { error: "Unsupported file — upload plastic-rates.db or navrit-migration-*.zip" },
        { status: 400 }
      );
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Import failed" },
        { status: 400 }
      );
    }
  }

  const body = await req.json().catch(() => ({}));

  if (body?.action === "restore") {
    try {
      const result = restoreBackup(String(body.filename || ""));
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Restore failed" },
        { status: 400 }
      );
    }
  }

  if (body?.action === "createMigrationPack") {
    try {
      const pack = await createMigrationPackBuffer();
      return NextResponse.json({
        ok: true,
        pack: {
          filename: pack.filename,
          sizeLabel: pack.sizeLabel,
          meta: pack.meta,
        },
        // Client can also hit download URL; include base64 only for small packs is heavy — use download endpoint
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Migration pack failed" },
        { status: 500 }
      );
    }
  }

  if (body?.action === "downloadMigrationPack") {
    try {
      const pack = await createMigrationPackBuffer();
      return new NextResponse(new Uint8Array(pack.buffer), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${pack.filename}"`,
          "X-Migration-Checksum": pack.meta.dbChecksum,
        },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Migration pack failed" },
        { status: 500 }
      );
    }
  }

  try {
    const reason = typeof body?.reason === "string" ? body.reason : "admin";
    const info = createBackup(reason);
    return NextResponse.json({
      ok: true,
      backup: { ...info, sizeLabel: formatBytes(info.size) },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Backup failed" },
      { status: 500 }
    );
  }
}
