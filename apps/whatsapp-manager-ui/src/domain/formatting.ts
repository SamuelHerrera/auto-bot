export function formatCountLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}
