import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as r53targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface BoulderStackProps extends StackProps {
  zoneName: string;
  hostedZoneId?: string;
  domainName: string;
  /** Outros endereços do mesmo app (mesmo site, login e dados). */
  aliasDomains: string[];
  cognitoDomainPrefix: string;
  aiModel: string;
  aiDailyLimit: number;
  alertEmail?: string;
  /** E-mails do login saem pelo SES (no-reply@zona). Só ligar com a conta fora do sandbox do SES:
   *  em sandbox o SES só entrega para endereços verificados e o cadastro de amigos quebraria. */
  emailViaSes: boolean;
  /** Para onde vão as respostas aos e-mails do login (opcional; fica fora do código). */
  replyToEmail?: string;
}

/** Boulder Log: site (CloudFront + S3), API (HTTP API + 1 Lambda), dados (DynamoDB),
 *  fotos (S3 privado, upload/download assinados), login (Cognito) e IA (Bedrock). */
export class BoulderStack extends Stack {
  constructor(scope: Construct, id: string, props: BoulderStackProps) {
    super(scope, id, props);
    const origin = `https://${props.domainName}`;
    const domains = [props.domainName, ...props.aliasDomains];
    const allOrigins = domains.map((d) => `https://${d}`);

    // ---------- Dados ----------
    // Dados do usuário: nada de DESTROY aqui.
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const photos = new s3.Bucket(this, 'Photos', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [{ allowedOrigins: allOrigins, allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET], allowedHeaders: ['*'], maxAge: 3600 }],
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(1) }],
    });
    const webBucket = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------- Lambda (uma só, roteada por routeKey) ----------
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: path.join(ROOT, 'services', 'api.ts'),
      handler: 'handler',
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024, // mais CPU: respostas e cold start mais rápidos (custo continua irrisório)
      timeout: Duration.seconds(29), // limite do HTTP API; a análise de IA leva poucos segundos
      environment: {
        TABLE_NAME: table.tableName,
        PHOTO_BUCKET: photos.bucketName,
        ALLOWED_ORIGIN: allOrigins.join(','),
        AI_MODEL: props.aiModel,
        AI_DAILY_LIMIT: String(props.aiDailyLimit),
        AI_GLOBAL_LIMIT: '200',
      },
      logGroup: new logs.LogGroup(this, 'ApiFnLogs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
      bundling: { minify: true, externalModules: [] },
    });
    table.grantReadWriteData(apiFn);
    photos.grantReadWrite(apiFn, 'photos/*');
    photos.grantDelete(apiFn, 'photos/*');
    // Converse no modelo de AI_MODEL: o perfil de inferência (us.*) e os modelos de base para onde ele roteia.
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/${props.aiModel}`,
        // o perfil (us.*) roteia para o modelo de base de mesmo nome em várias regiões
        `arn:aws:bedrock:*::foundation-model/${props.aiModel.replace(/^(us|eu|apac|global)\./, '')}`,
      ],
    }));

    const zone = props.hostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: props.hostedZoneId, zoneName: props.zoneName })
      : route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.zoneName });

    // ---------- E-mail (SES): domínio com DKIM e MAIL FROM próprio, para não cair no spam ----------
    new ses.EmailIdentity(this, 'MailDomain', {
      identity: ses.Identity.publicHostedZone(zone), // cria os CNAMEs do DKIM na zona
      mailFromDomain: `mail.${props.zoneName}`, // MX + SPF criados na zona
    });
    // DMARC em modo só observação: alinha DKIM/SPF e ajuda o Gmail a confiar no domínio.
    new route53.TxtRecord(this, 'Dmarc', { zone, recordName: `_dmarc.${props.zoneName}`, values: ['v=DMARC1; p=none;'] });
    const fromEmail = `no-reply@${props.zoneName}`;

    // ---------- Login (Cognito Managed Login com a cara do app) ----------
    const userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: 'boulder-log',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      mfa: cognito.Mfa.OFF,
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      email: props.emailViaSes
        ? cognito.UserPoolEmail.withSES({ fromEmail, fromName: 'Chalkmark', replyTo: props.replyToEmail, sesVerifiedDomain: props.zoneName })
        : cognito.UserPoolEmail.withCognito(props.replyToEmail),
      // Mesmo texto para o código de cadastro e o de "esqueci a senha" (o Cognito usa este modelo
      // para os dois); em português e inglês porque o Cognito não sabe o idioma da pessoa.
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailSubject: 'Seu código do Chalkmark / Your Chalkmark code',
        emailBody: readFileSync(path.join(ROOT, 'infra', 'email-code.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s*\n\s*/g, ''),
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // Excluir a conta apaga também o login.
    apiFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
    userPool.grant(apiFn, 'cognito-idp:AdminDeleteUser');
    userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.cognitoDomainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const redirect = `${origin}/`;
    const client = userPool.addClient('Spa', {
      generateSecret: false,
      authFlows: {},
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: allOrigins.map((o) => `${o}/`),
        logoutUrls: allOrigins.map((o) => `${o}/`),
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });
    // Mesmas cores do app; DYNAMIC segue o tema claro/escuro do aparelho.
    const btn = (bg: string, hover: string, active: string) => ({
      defaults: { backgroundColor: bg, textColor: 'ffffffff' },
      hover: { backgroundColor: hover, textColor: 'ffffffff' },
      active: { backgroundColor: active, textColor: 'ffffffff' },
    });
    new cognito.CfnManagedLoginBranding(this, 'LoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      // Logo do Chalkmark (risco de giz sobre a agarra) acima do formulário, nos dois temas.
      assets: (['LIGHT', 'DARK'] as const).map((colorMode) => ({
        category: 'FORM_LOGO',
        colorMode,
        extension: 'SVG',
        bytes: readFileSync(path.join(ROOT, 'web', 'icon.svg')).toString('base64'),
      })),
      settings: {
        categories: {
          global: { colorSchemeMode: 'DYNAMIC' },
          form: { displayGraphics: false },
        },
        components: {
          pageBackground: { image: { enabled: false }, lightMode: { color: 'f6f5f2ff' }, darkMode: { color: '151514ff' } },
          form: {
            borderRadius: 12,
            lightMode: { backgroundColor: 'ffffffff', borderColor: 'e4e2ddff' },
            darkMode: { backgroundColor: '1f1f1dff', borderColor: '2e2e2bff' },
          },
          primaryButton: {
            lightMode: btn('c4502aff', 'a94322ff', '8f381cff'),
            darkMode: btn('e0663cff', 'ea7a52ff', 'c4502aff'),
          },
        },
      },
    });

    // ---------- API ----------
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', { createDefaultStage: false });
    new apigwv2.HttpStage(this, 'Stage', { httpApi, stageName: '$default', autoDeploy: true, throttle: { rateLimit: 20, burstLimit: 40 } });
    const integration = new HttpLambdaIntegration('ApiInt', apiFn);
    const authorizer = new HttpUserPoolAuthorizer('Auth', userPool, { userPoolClients: [client] });
    const M = apigwv2.HttpMethod;
    const routes: [string, apigwv2.HttpMethod][] = [
      ['/api/gyms', M.GET], ['/api/gyms', M.POST], ['/api/gyms/{id}', M.PATCH],
      ['/api/sessions', M.GET], ['/api/sessions', M.POST], ['/api/sessions/{id}', M.PATCH],
      ['/api/climbs', M.GET], ['/api/climbs', M.POST],
      ['/api/climbs/{id}', M.PATCH], ['/api/climbs/{id}', M.DELETE],
      ['/api/climbs/{id}/media', M.GET], ['/api/climbs/{id}/analyze', M.POST],
      ['/api/settings', M.GET], ['/api/settings', M.PUT],
      ['/api/climbs/{id}/share', M.POST], ['/api/shares/{id}', M.GET], ['/api/shares/{id}/accept', M.POST],
      ['/api/account', M.DELETE], ['/api/feedback', M.POST],
      ['/api/profile', M.GET], ['/api/profile', M.PUT], ['/api/users', M.GET], ['/api/users/{handle}', M.GET],
      ['/api/users/{handle}/follow', M.POST], ['/api/users/{handle}/follow', M.DELETE],
      ['/api/users/{handle}/climbs/{id}/copy', M.POST], ['/api/social', M.GET],
    ];
    for (const [p, method] of routes) httpApi.addRoutes({ path: p, methods: [method], integration, authorizer });

    // ---------- Site: CloudFront com S3 e a API na mesma origem ----------
    const certificate = new acm.Certificate(this, 'Cert', { domainName: props.domainName, subjectAlternativeNames: props.aliasDomains, validation: acm.CertificateValidation.fromDns(zone) });
    const cognitoDomain = `https://${props.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`;
    const s3Hosts = `https://${photos.bucketName}.s3.amazonaws.com https://${photos.bucketName}.s3.${this.region}.amazonaws.com`;
    const csp = [
      "default-src 'self'",
      // wasm-unsafe-eval: só permite compilar WebAssembly (o detector de agarras), não eval de JS.
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self'",
      `img-src 'self' blob: data: ${s3Hosts}`,
      `connect-src 'self' ${s3Hosts} ${cognitoDomain}`,
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
    ].join('; ');
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
      // Isolamento de origem: libera o detector em várias threads. "credentialless" mantém as
      // fotos do S3 carregando sem cabeçalho extra; navegador sem suporte roda em 1 thread.
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cross-Origin-Opener-Policy', value: 'same-origin', override: true },
          { header: 'Cross-Origin-Embedder-Policy', value: 'credentialless', override: true },
        ],
      },
    });
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      domainNames: domains,
      certificate,
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // gzip + brotli
        responseHeadersPolicy: headers,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(Fn.select(2, Fn.split('/', httpApi.apiEndpoint))),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
      },
    });
    const alias = route53.RecordTarget.fromAlias(new r53targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'AliasA', { zone, recordName: props.domainName, target: alias });
    new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName: props.domainName, target: alias });
    for (const d of props.aliasDomains) {
      const key = d.split('.')[0];
      new route53.ARecord(this, `AliasA-${key}`, { zone, recordName: d, target: alias });
      new route53.AaaaRecord(this, `AliasAAAA-${key}`, { zone, recordName: d, target: alias });
    }

    // ---------- Publicação do site ----------
    // Assets com hash no nome: cache de 1 ano. Páginas e config: sempre revalidadas.
    // prune: false nos dois para abas abertas não perderem o JS da versão anterior.
    const dist = path.join(ROOT, 'dist');
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(path.join(dist, 'static'))],
      destinationBucket: webBucket,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
    });
    // Runtime WebAssembly do detector (15 MB → 3,7 MB): já vai em gzip, porque o CloudFront
    // só comprime arquivos de até 10 MB. A versão do onnxruntime está no caminho.
    new s3deploy.BucketDeployment(this, 'DeployWasm', {
      sources: [s3deploy.Source.asset(path.join(dist, 'gz'))],
      destinationBucket: webBucket,
      contentEncoding: 'gzip',
      contentType: 'application/wasm',
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
      memoryLimit: 512,
    });
    new s3deploy.BucketDeployment(this, 'DeployPages', {
      sources: [
        s3deploy.Source.asset(path.join(dist, 'pages')),
        s3deploy.Source.jsonData('config.json', {
          cognitoDomain,
          clientId: client.userPoolClientId,
          redirectUri: redirect,
        }),
      ],
      destinationBucket: webBucket,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache')],
      prune: false,
      distribution,
      distributionPaths: ['/*'],
    });

    // ---------- Alerta de custo ----------
    if (props.alertEmail) {
      new budgets.CfnBudget(this, 'Budget', {
        budget: { budgetName: 'boulder-log-monthly', budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 5, unit: 'USD' } },
        notificationsWithSubscribers: [{
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
        }],
      });
    }

    new CfnOutput(this, 'Url', { value: origin });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
