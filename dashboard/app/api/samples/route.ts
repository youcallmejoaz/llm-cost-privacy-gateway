import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const file = process.env.SAMPLES_PATH ?? path.resolve(process.cwd(), '..', 'demo', 'sample-requests.json');
  return new Response(await readFile(/*turbopackIgnore: true*/ file, 'utf8'), { headers: { 'content-type': 'application/json' } });
}
