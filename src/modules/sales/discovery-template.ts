import { CALCULATOR_KEYS } from './calculator';

// Tony's discovery call, as a call sheet. Loaded into a workspace with one click and fully editable afterwards.
// `script` is what the rep says; `fields` are what the rep finds out and types in.

type T = 'text' | 'long_text' | 'number' | 'currency' | 'date' | 'boolean' | 'select' | 'multi_select';
export type TemplateField = { key: string; label: string; type: T; required?: boolean; options?: string[] };
export type TemplateSection = { id: string; title: string; script?: string; calculator?: boolean; fields: TemplateField[] };

const PAY = ['Pay in full', 'Payment plan', 'Undecided'];

export const DISCOVERY_TEMPLATE: TemplateSection[] = [
  { id: 'frame', title: '1. Set the frame', fields: [],
    script: 'Before we discuss solutions, I’m going to ask a few questions to understand where you are, where you want to go, and what’s preventing you from getting there. If I believe we can help, I’ll explain what working together looks like. Then we can decide whether there’s a fit. Sound good?' },
  { id: 'current', title: '2. Current situation', calculator: true, fields: [
    { key: 'lead_sources', label: 'Walk me through your business. How are you getting leads right now?', type: 'long_text' },
    { key: CALCULATOR_KEYS.leadsPerMonth, label: 'Leads per month', type: 'number', required: true },
    { key: CALCULATOR_KEYS.closeRate, label: 'Close rate % (for every 10 appointments, how many do you close? 2.5 of 10 = 25)', type: 'number', required: true },
    { key: CALCULATOR_KEYS.avgJob, label: 'Average price you sell a job for', type: 'currency', required: true },
    { key: CALCULATOR_KEYS.hoursPerWeek, label: 'Hours a week on the truck', type: 'number', required: true },
  ] },
  { id: 'desired', title: '3. Desired situation', fields: [
    { key: 'revenue_goal', label: 'What monthly revenue are you trying to reach?', type: 'currency' },
    { key: 'goal_6_months', label: 'What goal would you like to reach in 6 months?', type: 'text' },
    { key: 'goal_12_months', label: 'And in 12 months?', type: 'text' },
    { key: 'ninety_days_different', label: 'If we spoke again 90 days from now and this problem was solved, what would be different?', type: 'long_text' },
    { key: 'result_allows', label: 'What would achieving that result allow you to do?', type: 'long_text' },
    { key: 'why_personal', label: 'Why is this goal important to you personally?', type: 'long_text' },
    { key: 'why_now', label: 'Why does this need to happen now?', type: 'long_text' },
  ] },
  { id: 'gap', title: '4. Identify the gap', fields: [
    { key: 'whats_preventing', label: 'What do you believe is preventing you from reaching that goal?', type: 'long_text' },
    { key: 'why_not_solved', label: 'Why haven’t you been able to solve it on your own?', type: 'long_text' },
    { key: 'already_tried', label: 'What have you already tried?', type: 'long_text' },
    { key: 'previous_coaching', label: 'Have you previously gone through coaching or an agency?', type: 'boolean' },
    { key: 'what_worked', label: 'What worked?', type: 'long_text' },
    { key: 'what_didnt_work', label: 'What didn’t work?', type: 'long_text' },
    { key: 'invested_so_far', label: 'How much have you already invested in trying to solve this?', type: 'currency' },
    { key: 'missing', label: 'What do you believe you are missing?', type: 'multi_select', options: ['Strategy', 'Systems', 'Support', 'Accountability', 'Execution', 'Something else'] },
    { key: 'if_nothing_changes', label: 'If nothing changes, where do you think the business will be six months from now?', type: 'long_text' },
  ] },
  { id: 'commitment', title: '5. Understand their commitment', fields: [
    { key: 'time_per_week', label: 'How much time can you dedicate to implementing this each week?', type: 'text' },
    { key: 'will_follow_process', label: 'Are you willing to follow a process consistently?', type: 'boolean' },
    { key: 'start_speed', label: 'How quickly are you prepared to get started?', type: 'select', options: ['Right away', 'Within 2 weeks', 'Within a month', 'Later'] },
    { key: 'main_priority', label: 'Is solving this one of your main priorities right now?', type: 'boolean' },
    { key: 'could_prevent', label: 'What could potentially prevent you from moving forward?', type: 'long_text' },
  ] },
  { id: 'decision', title: '6. Decision and financial qualification', fields: [
    { key: 'others_involved', label: 'Besides you, is anyone else involved in making this decision?', type: 'boolean' },
    { key: 'spouse_or_partner', label: 'Would you need to discuss this with a spouse or business partner?', type: 'boolean' },
    { key: 'who_else', label: 'Does anyone else need to be involved before you can make a decision? Who?', type: 'text' },
    { key: 'budget_allocated', label: 'Have you allocated a budget toward solving this problem?', type: 'boolean' },
    { key: 'financially_prepared', label: 'If you believed this was the right solution, would you be financially prepared to move forward?', type: 'boolean' },
    { key: 'payment_preference', label: 'Would you prefer to pay in full or use a payment plan?', type: 'select', options: PAY },
  ] },
  { id: 'summary', title: '7. Summarize the discovery',
    script: 'So, if I’m understanding you correctly, you’re currently at [current situation], you want to reach [desired result], and the main things preventing you from getting there are [key obstacles]. You’ve already tried [previous attempts], but you still haven’t been able to create [desired outcome]. Is that accurate?',
    fields: [
      { key: 'not_asked', label: 'Is there anything important I haven’t asked about?', type: 'long_text' },
      { key: 'solve_first', label: 'Of everything we discussed, what needs to be solved first?', type: 'long_text' },
      { key: 'importance_now', label: 'How important is it for you to solve this now?', type: 'text' },
    ] },
  { id: 'offer', title: '8. Transition into the offer',
    script: 'Based on everything you’ve shared, I do believe we can help. Would you be open to hearing what I’m seeing and how I think we could close the gap?\n\nAfter explaining the offer, ask:',
    fields: [
      { key: 'alignment_score', label: 'On a scale of 1–10, how well does this feel aligned with what you need?', type: 'number' },
      { key: 'why_that_number', label: 'Why did you choose that number?', type: 'long_text' },
      { key: 'to_reach_9_or_10', label: 'What would need to be addressed for it to become a 9 or 10?', type: 'long_text' },
      { key: 'questions_before_investment', label: 'Do you have any questions before we discuss the investment?', type: 'long_text' },
    ] },
  { id: 'close', title: '9. Close and next step', fields: [
    { key: 'right_solution', label: 'Does this feel like the right solution for you?', type: 'boolean' },
    { key: 'ready_to_move', label: 'Are you ready to move forward?', type: 'boolean' },
    { key: 'chosen_option', label: 'Would you prefer the pay-in-full option or the payment plan?', type: 'select', options: PAY },
    { key: 'needed_to_decide', label: 'If you’re not ready today, what specifically needs to happen before you can decide?', type: 'long_text' },
    { key: 'reconnect_on', label: 'When should we reconnect to make the final decision?', type: 'date' },
  ] },
];
