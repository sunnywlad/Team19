import { marketAbi } from './market.ts';

export const marketErrorsAbi = [
  {
    type: 'error',
    name: 'RevealWindowClosed',
    inputs: [{ name: 'requestId', type: 'uint256' }],
  },
] as const;

export const marketAbiWithErrors = [...marketAbi, ...marketErrorsAbi] as const;
