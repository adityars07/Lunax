import dotenv from 'dotenv';
dotenv.config();

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  routerModel: process.env.ROUTER_MODEL || 'gpt-4o-mini',
  synthModel:   process.env.SYNTH_MODEL  || 'gpt-4o',
  claimsModel:  process.env.CLAIMS_MODEL || 'gpt-4o-mini',
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || './lunax.db',
};

export function validateApiKeys(): void {
  const missing: string[] = [];
  if (!config.openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!config.tavilyApiKey) missing.push('TAVILY_API_KEY');

  if (missing.length > 0) {
    console.warn(`\n⚠️  Missing environment variables: ${missing.join(', ')}`);
    console.warn(`   Copy .env.example to .env and fill in your keys.\n`);
  }
}

