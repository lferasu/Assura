const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function computeDayOfWeek(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return WEEKDAYS[utc.getUTCDay()];
}

function formatLongDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function describeChange(change) {
  const day = change.dayOfWeek || computeDayOfWeek(change.date);
  const dateLabel = formatLongDate(change.date);

  let attendance;
  if (change.studentsAttend) {
    attendance = "School IS in session";
  } else {
    attendance = "NO school for students";
  }

  const details = [];
  if (change.staffWorkDay === true) details.push("staff work day");
  if (change.staffWorkDay === false) details.push("staff not scheduled to work");
  if (change.notes) details.push(change.notes);

  const detailSuffix = details.length ? ` (${details.join("; ")}).` : ".";
  return `${day}, ${dateLabel}: ${attendance}${detailSuffix}`;
}

export function summarizeExtraction(extracted) {
  if (extracted.type === "not_schedule_change" || extracted.changes.length === 0) {
    return "No schedule-impacting change detected.";
  }
  return extracted.changes.map(describeChange).join("\n");
}
