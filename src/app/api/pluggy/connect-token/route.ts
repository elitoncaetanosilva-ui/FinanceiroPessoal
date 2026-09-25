import { NextResponse } from 'next/server';
import { pluggy, pluggyConfigurado } from '@/lib/sync';

export async function POST(req: Request) {
  if (!pluggyConfigurado()) return NextResponse.json({ erro: 'Pluggy não configurada (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET).' }, { status: 400 });
  const { itemId } = (await req.json().catch(() => ({}))) as { itemId?: string };
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const webhookUrl = host && process.env.PLUGGY_WEBHOOK_SECRET
    ? `https://${host}/api/pluggy/webhook?secret=${encodeURIComponent(process.env.PLUGGY_WEBHOOK_SECRET)}`
    : undefined;
  try {
    const { accessToken } = await pluggy().createConnectToken(itemId, { webhookUrl, clientUserId: 'caixa-pessoal', avoidDuplicates: true });
    return NextResponse.json({ accessToken });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
