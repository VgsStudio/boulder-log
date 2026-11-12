// Lambda do agendamento (EventBridge, de hora em hora): manda o lembrete diário de quem está no balde
// desta hora. Toda a lógica está em push.ts.
export { notifyHandler as handler } from './push.ts';
