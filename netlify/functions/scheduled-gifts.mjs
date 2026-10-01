import { getStore } from '@netlify/blobs';
import schedules from '../../lib/schedules.js';
export default async () => {
  const completed = await schedules.runScheduled(getStore({ name: 'everest-alt', consistency: 'strong' }));
  console.log(`Completed ${completed} scheduled gift simulations`);
};
export const config = { schedule: '@hourly' };
