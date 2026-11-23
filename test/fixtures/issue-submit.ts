import type { Counterparty } from '../../src/issue.ts';
import type { Job } from '../../src/queue.ts';

export const jobs: Job[] = [];
export const requests: unknown[] = [];

const session = { pc: 'online', data: { pair: {}, pcCopy: [{ id: 'cp_known' }] } };

export const useSession = () => session;
export const counterpartiesOf = (copy: Counterparty[]) => copy;
export const useQueue = () => ({ add: (job: Job) => jobs.push(job) });
export const useEntrust = () => async (input: unknown) => {
  requests.push(input);
  return true;
};
