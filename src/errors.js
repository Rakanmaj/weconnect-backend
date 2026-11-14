export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  throw error;
}
export function validate(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) fail(400, result.error.issues[0]?.message || 'Check the form fields.');
  return result.data;
}
export const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
