/** Original punches are evidence; this function never edits them or automatically approves pay. */
export function attendanceSummary(a: Record<string, unknown>, now = Date.now()) {
  const start = new Date(String(a.starts_at)).getTime(),
    end = new Date(String(a.ends_at)).getTime();
  const enter = a.checked_in_at ? new Date(String(a.checked_in_at)).getTime() : null;
  const exit = a.checked_out_at ? new Date(String(a.checked_out_at)).getTime() : null;
  const grace = Number(a.attendance_grace_minutes ?? 15),
    unpaid = Number(a.break_minutes ?? 0);
  const planned = Math.max(0, Math.floor((end - start) / 60000) - unpaid);
  const complete = enter !== null && exit !== null;
  const inside = complete
    ? Math.max(0, Math.floor((Math.min(end, exit) - Math.max(start, enter)) / 60000))
    : 0;
  const actual = Math.max(0, inside - unpaid);
  const late = enter === null ? null : Math.max(0, Math.ceil((enter - start) / 60000));
  const early = exit === null ? null : Math.max(0, Math.ceil((end - exit) / 60000));
  const outside = complete
    ? Math.max(0, Math.floor((start - enter) / 60000)) +
      Math.max(0, Math.floor((exit - end) / 60000))
    : 0;
  const expired = now > end + Number(a.clock_out_late_minutes ?? 120) * 60000;
  const normal = complete && inside > 0 && late! <= grace && early! <= grace;
  const flags: string[] = [];
  if (late !== null && late > grace) flags.push('LATE');
  if (early !== null && early > grace) flags.push('EARLY_LEAVE');
  if (outside > 0) flags.push('OUTSIDE');
  if (now >= end && !enter) flags.push('MISSING_IN');
  if (enter && !exit && expired) flags.push('MISSING_OUT');
  const classification =
    a.status === 'CANCELLED'
      ? 'CANCELLED'
      : a.attendance_status === 'APPROVED' || a.status === 'APPROVED'
        ? a.outcome === 'LEAVE'
          ? 'LEAVE'
          : a.outcome === 'ABSENT'
            ? 'ABSENT'
            : 'APPROVED'
        : !enter && now >= end
          ? 'MISSING_IN'
          : enter && !exit
            ? expired
              ? 'MISSING_OUT'
              : 'ACTIVE'
            : !complete
              ? 'SCHEDULED'
              : late! > grace
                ? 'LATE'
                : early! > grace
                  ? 'EARLY_LEAVE'
                  : outside > grace
                    ? 'OUTSIDE'
                    : 'NORMAL';
  return {
    ...a,
    scheduled_minutes: planned,
    actual_minutes: actual,
    suggested_minutes: normal ? planned : actual,
    late_minutes: late,
    early_leave_minutes: early,
    outside_minutes: outside,
    attendance_flags: flags,
    classification,
    requires_exception: flags.some((f) => f !== 'OUTSIDE') || outside > grace,
    can_check_in:
      !enter &&
      a.status === 'ASSIGNED' &&
      a.attendance_status !== 'APPROVED' &&
      now >= start - Number(a.clock_in_early_minutes ?? 15) * 60000 &&
      now <= end,
    can_check_out:
      enter !== null &&
      exit === null &&
      !expired &&
      a.status === 'ASSIGNED' &&
      a.attendance_status !== 'APPROVED',
    check_out_deadline: new Date(
      end + Number(a.clock_out_late_minutes ?? 120) * 60000,
    ).toISOString(),
  };
}
