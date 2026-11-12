// Entrada do CDK. Nenhum ID de conta, zona ou ARN fica no código:
// tudo vem de variáveis de ambiente (local: .env; CI: GitHub "variables").
import { App, Tags } from 'aws-cdk-lib';
import { BoulderStack } from './boulder-stack.ts';
import { OidcStack } from './oidc-stack.ts';

const app = new App();
// us-east-1 fixo: o certificado do CloudFront precisa estar nessa região.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };
const e = process.env;

// Tags em todos os recursos (custos por projeto no Cost Explorer; quem criou e quem responde).
for (const [k, v] of Object.entries({ project: e.TAG_PROJECT || 'chalkmark', creator: e.TAG_CREATOR || 'vsoller', owner: e.TAG_OWNER || 'vsoller' })) Tags.of(app).add(k, v);

new BoulderStack(app, 'BoulderLog-App', {
  env,
  zoneName: e.ZONE_NAME || 'vsoller.com.br',
  hostedZoneId: e.HOSTED_ZONE_ID || undefined,
  domainName: e.APP_DOMAIN || 'boulder.vsoller.com.br',
  aliasDomains: (e.APP_ALIASES ?? 'chalkmark.vsoller.com.br').split(',').filter(Boolean),
  cognitoDomainPrefix: e.COGNITO_DOMAIN_PREFIX || 'vgs-boulder-log',
  aiModel: e.AI_MODEL || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  aiDailyLimit: Number(e.AI_DAILY_LIMIT || 20),
  alertEmail: e.ALERT_EMAIL || undefined,
  emailViaSes: e.EMAIL_VIA_SES === 'true',
  googleOAuth: e.GOOGLE_OAUTH === 'true',
  replyToEmail: e.REPLY_TO_EMAIL || undefined,
});

// Só cria o papel do GitHub Actions quando a claim do repositório é informada.
if (e.GITHUB_REPO_CLAIM) {
  new OidcStack(app, 'BoulderLog-Oidc', { env, githubRepoClaim: e.GITHUB_REPO_CLAIM });
}
