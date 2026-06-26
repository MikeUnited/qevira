export function isOrderOverdue(deliveryDate: string | null): boolean {
  if (!deliveryDate) return false;
  const due = new Date(deliveryDate);
  due.setHours(23, 59, 59, 999); // end of due date
  return new Date() > due;
}

export function formatOverdueText(deliveryDate: string): string {
  const due = new Date(deliveryDate);
  const now = new Date();
  const daysOverdue = Math.floor(
    (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysOverdue === 0) return "Due today";
  if (daysOverdue === 1) return "Overdue by 1 day";
  return `Overdue by ${daysOverdue} days`;
}
