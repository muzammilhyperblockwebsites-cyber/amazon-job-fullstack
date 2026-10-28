export async function readApiResponse(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.status === 404
      ? 'The backend route is missing. Deploy the matching Heroku backend.'
      : `The server returned an unexpected response (${response.status}). Please retry.`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}
