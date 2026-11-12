// Gatilho "antes do cadastro" do Cognito: uma pessoa = uma conta, mesmo entrando de jeitos diferentes.
// - Entrou com Google e já existe conta de e-mail e senha com o mesmo e-mail: vincula o Google a ela
//   (a pessoa cai na conta de sempre, com os mesmos dados).
// - Criou conta com e-mail e senha, mas o e-mail já é de uma conta Google: recusa e manda usar o Google.
import { AdminLinkProviderForUserCommand, CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

interface PreSignUpEvent {
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: { userAttributes: Record<string, string> };
  response: Record<string, unknown>;
}

async function usersWithEmail(userPoolId: string, email: string) {
  // E-mail vem do provedor (Google) ou do formulário; aspas escapadas no filtro.
  const { Users } = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId, Filter: `email = "${email.replace(/"/g, '')}"`, Limit: 10 }));
  return Users ?? [];
}

export async function handler(event: PreSignUpEvent) {
  const email = (event.request.userAttributes.email ?? '').toLowerCase();
  if (!email) return event;
  const users = await usersWithEmail(event.userPoolId, email);

  if (event.triggerSource === 'PreSignUp_ExternalProvider') {
    // Só vincula com e-mail que o Google garante ser da pessoa.
    if (event.request.userAttributes.email_verified !== 'true') return event;
    const native = users.find((u) => u.UserStatus !== 'EXTERNAL_PROVIDER');
    if (native) {
      const [provider, ...rest] = event.userName.split('_'); // ex.: google_1234
      await cognito.send(new AdminLinkProviderForUserCommand({
        UserPoolId: event.userPoolId,
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: native.Username },
        SourceUser: { ProviderName: provider.charAt(0).toUpperCase() + provider.slice(1), ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: rest.join('_') },
      }));
      console.log(JSON.stringify({ msg: 'linked', provider }));
    }
    return event;
  }

  if (event.triggerSource === 'PreSignUp_SignUp' && users.some((u) => u.UserStatus === 'EXTERNAL_PROVIDER')) {
    throw new Error('USE_GOOGLE');
  }
  return event;
}
