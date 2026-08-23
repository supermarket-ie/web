import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const model = new Supabase.ai.Session("gte-small");

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => ({})) as { texts?: unknown };
  if (!Array.isArray(body.texts) || body.texts.length < 1 || body.texts.length > 50) {
    return Response.json({ error: "Provide between 1 and 50 texts" }, { status: 400 });
  }

  const texts = body.texts.map(value => String(value).trim().slice(0, 1000));
  if (texts.some(value => value.length === 0)) {
    return Response.json({ error: "Texts must not be empty" }, { status: 400 });
  }

  const embeddings = [];
  for (const text of texts) {
    embeddings.push(await model.run(text, { mean_pool: true, normalize: true }));
  }

  return Response.json({ model: "gte-small", dimensions: 384, embeddings });
});
