/** Shared labour day / wage math (9-hour workday for OT). */

export function halfDayRate(dailyRate: number) {
  return Math.round((Number(dailyRate || 0) / 2) * 100) / 100;
}

export function overtimePay(dailyRate: number, hours: number) {
  const ot = Number(hours || 0);
  if (!(ot > 0)) return 0;
  return Math.round((Number(dailyRate || 0) / 9) * ot * 100) / 100;
}

/** Earned ₹ for one attendance row from current daily rate (not stored amount). */
export function attendanceEarnedAmount(
  dailyRate: number,
  attendanceType?: string,
  hours = 0
) {
  const daily = Number(dailyRate || 0);
  const type = attendanceType || "FULL_DAY";
  if (type === "CUSTOM_HOURS") {
    return overtimePay(daily, hours);
  }
  const base = type === "HALF_DAY" ? halfDayRate(daily) : daily;
  // FULL_DAY / HALF_DAY: hours field stores overtime hours
  return Math.round((base + overtimePay(daily, hours)) * 100) / 100;
}

/** Day units for overview (full=1, half=0.5). */
export function attendanceDayUnits(attendanceType?: string, hours = 0) {
  const type = attendanceType || "FULL_DAY";
  if (type === "HALF_DAY") return 0.5;
  if (type === "CUSTOM_HOURS") return Math.round((Number(hours || 0) / 9) * 100) / 100;
  return 1;
}
