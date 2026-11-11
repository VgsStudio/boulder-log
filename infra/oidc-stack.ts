import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface OidcStackProps extends StackProps {
  /** "Owner/repo" (ex.: VgsStudio/boulder-log). */
  githubRepoClaim: string;
}

/** Deixa o GitHub Actions (só na branch main) rodar `cdk deploy` sem access key.
 *  Usa o provedor OIDC do GitHub que já existe na conta (o mesmo do serverless-selfie). */
export class OidcStack extends Stack {
  constructor(scope: Construct, id: string, props: OidcStackProps) {
    super(scope, id, props);
    const [owner, repo] = props.githubRepoClaim.split('/');
    const q = 'hnb659fds'; // qualificador padrão do cdk bootstrap
    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'github-actions-boulder-log-deploy',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
          // Aceita a claim clássica e a imutável (Owner@id/repo@id), só na main.
          StringLike: {
            'token.actions.githubusercontent.com:sub': [
              `repo:${owner}/${repo}:ref:refs/heads/main`,
              `repo:${owner}@*/${repo}@*:ref:refs/heads/main`,
            ],
          },
        },
      ),
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(
        (r) => `arn:aws:iam::${this.account}:role/cdk-${q}-${r}-role-${this.account}-${this.region}`,
      ),
    }));
  }
}
