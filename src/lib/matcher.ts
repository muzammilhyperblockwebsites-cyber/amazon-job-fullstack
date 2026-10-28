// Presentation helpers only; job scoring is owned by the backend.
export function matchLabel(score: number): string {
  return score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Low';
}
export function matchColour(score: number): string {
  return score >= 85 ? 'bg-green-600' : score >= 70 ? 'bg-blue-600' : score >= 50 ? 'bg-yellow-600' : 'bg-gray-500';
}
