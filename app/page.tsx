import Launch from './launch';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requireChatGPTUser('/');
  return (
    <Launch
      account={user.userId}
      name={user.fullName === 'Seedy' ? 'Scott' : user.fullName || 'Scott'}
    />
  );
}
