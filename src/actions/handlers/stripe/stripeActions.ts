/**
 * Stripe action handlers.
 *
 * Implemented:
 *   stripe.view_charge_details — sends charge details to Henry chat
 *   stripe.summarize_recent    — fetches recent charges and summarizes in chat
 *
 * Note: All Stripe actions are read-only. Refunds and modifications
 * are intentionally not implemented — they require confirmation-gated
 * flows and additional safety review before enabling.
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { stripeListCharges } from '../../../henry/integrations';
import { actionErrorMessage } from '../../voice/actionVoice';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

interface ChargeInput {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  description?: string;
  created?: number;
  customer?: string;
  receipt_email?: string;
  failure_message?: string;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function viewChargeDetails(input: ActionInput): Promise<ActionResult> {
  const charge = input as ChargeInput;
  const amount = charge.amount && charge.currency
    ? formatCurrency(charge.amount, charge.currency)
    : 'unknown amount';
  const date = charge.created
    ? new Date(charge.created * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const lines = [
    `I want to understand this Stripe charge:`,
    '',
    `ID: ${charge.id ?? 'unknown'}`,
    `Amount: ${amount}`,
    `Status: ${charge.status ?? 'unknown'}`,
    date ? `Date: ${date}` : null,
    charge.description ? `Description: ${charge.description}` : null,
    charge.receipt_email ? `Customer email: ${charge.receipt_email}` : null,
    charge.failure_message ? `Failure reason: ${charge.failure_message}` : null,
    '',
    `What does this charge tell me? Is there anything unusual about it I should investigate?`,
  ].filter(Boolean);

  sendToHenry(lines.join('\n'));
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

async function summarizeRecent(_input: ActionInput): Promise<ActionResult> {
  try {
    const charges = await stripeListCharges(10);

    if (charges.length === 0) {
      sendToHenry('My Stripe account has no recent charges. What should I be tracking to understand my revenue health?');
      return { success: true };
    }

    const lines = charges.map((c: any) => {
      const amt = formatCurrency(c.amount, c.currency);
      const date = new Date(c.created * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const status = c.status === 'succeeded' ? '✓' : c.status === 'failed' ? '✗' : '~';
      return `${status} ${amt}  ${date}  ${c.description || c.receipt_email || c.id}`;
    });

    const prompt = [
      `Here are my 10 most recent Stripe charges:`,
      '',
      ...lines,
      '',
      '1. How does this look overall?',
      '2. Any failed charges I should follow up on?',
      '3. What revenue pattern do you see here?',
    ].join('\n');

    sendToHenry(prompt);
    return { success: true, message: 'Opened in Henry chat' };
  } catch {
    return { success: false, message: actionErrorMessage('stripe.summarize_recent', 'chat') };
  }
}

export function registerStripeHandlers() {
  registerHandler('stripe.view_charge_details', viewChargeDetails);
  registerHandler('stripe.summarize_recent',    summarizeRecent);
}
