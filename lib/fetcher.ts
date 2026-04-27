export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error?.message ?? "Falha na requisicao.");
  }

  return data;
}
