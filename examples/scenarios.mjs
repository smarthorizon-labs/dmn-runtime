/**
 * Inputs and expected outputs for every example.
 *
 * Expectations are written as `describeValue` renderings, so they read the way
 * the runner prints them. They are asserted by `examples/examples.test.ts`,
 * which is what stops the examples rotting the next time semantics change.
 */

import { d, dt, n } from './values.mjs';

export const scenarios = {
  '01-greeting': {
    title: 'Greeting',
    complexity: 'Introductory',
    domain: 'Anything',
    summary: 'One input, one decision, one literal expression.',
    teaches: 'the load -> compile -> evaluate loop, and string concatenation',
    cases: [
      {
        name: 'English',
        inputs: { 'Full Name': 'Ada Lovelace', 'Preferred Language': 'en' },
        expect: { Greeting: '"Hello, Ada Lovelace!"' },
      },
      {
        name: 'Portuguese',
        inputs: { 'Full Name': 'Ada Lovelace', 'Preferred Language': 'pt' },
        expect: { Greeting: '"Ola, Ada Lovelace!"' },
      },
    ],
  },

  '02-shipping-cost': {
    title: 'Shipping cost',
    complexity: 'Simple',
    domain: 'Retail / logistics',
    summary: 'One UNIQUE decision table: weight bands against destination.',
    teaches: 'decision tables, numeric ranges, structured input data',
    cases: [
      {
        name: 'Light domestic parcel',
        inputs: { Parcel: { weightKg: n('1.2'), destination: 'Domestic' } },
        expect: { 'Shipping Cost': '4.95' },
      },
      {
        name: 'Heavy international parcel',
        inputs: { Parcel: { weightKg: n('14'), destination: 'International' } },
        expect: { 'Shipping Cost': '62' },
      },
      {
        name: 'Exactly on a band boundary',
        // [2..10) is half-open: 2 belongs to the second band, not the first.
        inputs: { Parcel: { weightKg: n('2'), destination: 'EU' } },
        expect: { 'Shipping Cost': '16.5' },
      },
    ],
  },

  '03-vat-classification': {
    title: 'VAT classification',
    complexity: 'Simple',
    domain: 'Tax / finance',
    summary: 'An ordered FIRST table with two outputs and a default output entry.',
    teaches: 'FIRST vs UNIQUE, multi-output tables, default outputs, decimal rounding',
    cases: [
      {
        name: 'Export overrides everything',
        inputs: { 'Line Item': { category: 'Books', isExport: true, netAmount: n('100') } },
        expect: {
          'VAT Treatment': '{rate: 0, code: "ZERO_RATED_EXPORT"}',
          'VAT Due': '0',
        },
      },
      {
        name: 'Reduced rate on domestic energy',
        inputs: { 'Line Item': { category: 'Domestic energy', isExport: false, netAmount: n('80') } },
        expect: { 'VAT Due': '4' },
      },
      {
        name: 'Nothing matches, so the default applies',
        inputs: { 'Line Item': { category: 'Furniture', isExport: false, netAmount: n('250') } },
        expect: {
          'VAT Treatment': '{rate: 0.2, code: "STANDARD"}',
          'VAT Due': '50',
        },
      },
    ],
  },

  '04-insurance-premium': {
    title: 'Insurance premium',
    complexity: 'Moderate',
    domain: 'Insurance',
    summary: 'Business knowledge models invoked from a chain of three decisions.',
    teaches: 'BKMs, knowledge requirements, dependency ordering, boxed contexts',
    cases: [
      {
        name: 'Young driver with claims',
        inputs: {
          Driver: { age: n('22'), yearsLicensed: n('2'), claimsLast5Years: n('3') },
          Vehicle: { value: n('18000'), category: 'Compact' },
        },
        expect: { 'Risk Class': '"High"', 'Annual Premium': '1008' },
      },
      {
        name: 'Experienced driver, clean record',
        inputs: {
          Driver: { age: n('45'), yearsLicensed: n('20'), claimsLast5Years: n('0') },
          Vehicle: { value: n('30000'), category: 'SUV' },
        },
        expect: {
          'Risk Class': '"Preferred"',
          'Annual Premium': '1402.5',
          'Policy Quote': '{monthly: 116.88, excess: 250, annual: 1402.5}',
        },
      },
    ],
  },

  '05-employee-leave': {
    title: 'Employee leave entitlement',
    complexity: 'Moderate',
    domain: 'HR',
    summary: 'Dates and durations, with the evaluation date supplied as an input.',
    teaches: 'temporal types, date properties, years-and-months duration, reproducibility',
    cases: [
      {
        name: 'Four years of service, standard band',
        inputs: {
          Employee: { hireDate: d('2021-03-15'), band: 'Standard', isPartTime: false },
          'As Of': d('2025-06-30'),
        },
        expect: {
          'Service Years': '4',
          Anniversary: '2025-03-15',
          'Leave Days': '28',
          Entitlement: '{days: 28, serviceYears: 4, longService: false}',
        },
      },
      {
        name: 'Long service, part time',
        inputs: {
          Employee: { hireDate: d('2010-01-05'), band: 'Senior', isPartTime: true },
          'As Of': d('2025-06-30'),
        },
        expect: {
          'Service Years': '15',
          'Leave Days': '35',
          Entitlement: '{days: 17, serviceYears: 15, longService: true}',
        },
      },
      {
        name: 'One day short of the anniversary',
        // A band boundary is a real cliff: one day changes the entitlement.
        inputs: {
          Employee: { hireDate: d('2022-07-01'), band: 'Standard', isPartTime: false },
          'As Of': d('2025-06-30'),
        },
        expect: { 'Service Years': '2', 'Leave Days': '25' },
      },
    ],
  },

  '06-clinical-triage': {
    title: 'Clinical triage',
    complexity: 'Moderate',
    domain: 'Healthcare',
    summary: 'PRIORITY hit policy: several rules match and the most severe wins.',
    teaches: 'PRIORITY, outputValues ordering, rule order not mattering',
    cases: [
      {
        name: 'Hypoxia outranks everything, though written last',
        inputs: {
          Vitals: {
            systolic: n('130'),
            heartRate: n('130'),
            oxygenSaturation: n('88'),
            temperature: n('37.2'),
          },
          'Presenting Complaint': 'Chest pain',
        },
        expect: { 'Triage Category': '"Immediate"' },
      },
      {
        name: 'Chest pain alone is urgent',
        inputs: {
          Vitals: {
            systolic: n('125'),
            heartRate: n('85'),
            oxygenSaturation: n('98'),
            temperature: n('36.8'),
          },
          'Presenting Complaint': 'Chest pain',
        },
        expect: { 'Triage Category': '"Urgent"' },
      },
      {
        name: 'Minor injury, normal observations',
        inputs: {
          Vitals: {
            systolic: n('120'),
            heartRate: n('72'),
            oxygenSaturation: n('99'),
            temperature: n('36.6'),
          },
          'Presenting Complaint': 'Minor injury',
        },
        expect: { 'Triage Category': '"Non-urgent"', 'Target Wait': 'PT4H' },
      },
    ],
  },

  '07-subscription-renewal': {
    title: 'Subscription renewal',
    complexity: 'Moderate',
    domain: 'SaaS / billing',
    summary: 'COLLECT with SUM: every matching rule contributes to the total.',
    teaches: 'COLLECT aggregation, list inputs, sum/mean/max/count, capping',
    cases: [
      {
        name: 'Loyal enterprise account, heavy usage',
        inputs: {
          Account: { plan: 'Enterprise', monthsActive: n('72'), openIncidents: n('0') },
          'Monthly Usage': [n('900'), n('1100'), n('850')],
        },
        // 10 (2y) + 5 (5y) + 8 (enterprise) + 7 (heavy) = 30, capped at 25.
        expect: {
          'Renewal Discount': '30',
          'Renewal Offer': '{discountPercent: 25, capped: true, plan: "Enterprise"}',
        },
      },
      {
        name: 'New account, light usage',
        inputs: {
          Account: { plan: 'Starter', monthsActive: n('4'), openIncidents: n('0') },
          'Monthly Usage': [n('12'), n('18'), n('9')],
        },
        // No rule matches, so COLLECT SUM over nothing is zero.
        expect: {
          'Usage Profile': '{total: 39, average: 13, peak: 18, months: 3}',
          'Renewal Discount': '0',
        },
      },
      {
        name: 'Poor service year earns a credit',
        inputs: {
          Account: { plan: 'Pro', monthsActive: n('30'), openIncidents: n('4') },
          'Monthly Usage': [n('300'), n('280')],
        },
        expect: { 'Renewal Discount': '15' },
      },
    ],
  },

  '08-fraud-risk': {
    title: 'Fraud and financial-crime triage',
    complexity: 'Complex',
    domain: 'Compliance / fraud prevention',
    summary:
      'Sanctions screening on a separate path from additive risk scoring, ' +
      'banded by PRIORITY and dispositioned into review queues.',
    teaches:
      'decision tables inside BKMs, COLLECT scoring, PRIORITY banding, ' +
      'a decision service as the deployable unit, and why screening is not a score',
    cases: [
      {
        name: 'Ordinary domestic purchase',
        inputs: {
          Transaction: {
            amount: n('64.20'),
            currency: 'EUR',
            channel: 'POS',
            timestamp: dt('2026-03-11T14:05:00'),
            merchantCategory: 'GROCERY',
            cardPresent: true,
            counterpartyCountry: 'PT',
          },
          Customer: {
            accountAgeDays: n('1400'),
            riskRating: 'LOW',
            isPEP: false,
            sanctionsScreening: 'CLEAR',
            homeCountry: 'PT',
          },
          Behaviour: {
            txCount24h: n('3'),
            txAmount24h: n('210'),
            distinctCountries7d: n('1'),
            priorConfirmedFraud: n('0'),
            averageTicket90d: n('58'),
          },
          'High Risk Countries': ['IR', 'KP', 'SY'],
        },
        expect: {
          'Risk Score': '0',
          'Risk Band': '"LOW"',
          'Case Disposition':
            '{action: "ALLOW", queue: "NONE", slaHours: 0, reasonCode: "RISK_LOW"}',
        },
      },
      {
        name: 'Confirmed sanctions match blocks regardless of a clean profile',
        inputs: {
          Transaction: {
            amount: n('50'),
            currency: 'EUR',
            channel: 'POS',
            timestamp: dt('2026-03-11T14:05:00'),
            merchantCategory: 'GROCERY',
            cardPresent: true,
            counterpartyCountry: 'PT',
          },
          Customer: {
            accountAgeDays: n('3000'),
            riskRating: 'LOW',
            isPEP: false,
            sanctionsScreening: 'CONFIRMED_MATCH',
            homeCountry: 'PT',
          },
          Behaviour: {
            txCount24h: n('1'),
            txAmount24h: n('50'),
            distinctCountries7d: n('1'),
            priorConfirmedFraud: n('0'),
            averageTicket90d: n('60'),
          },
          'High Risk Countries': ['IR', 'KP', 'SY'],
        },
        // The score is as low as it gets, and it changes nothing.
        expect: {
          'Risk Score': '0',
          'Risk Band': '"LOW"',
          'Screening Outcome': '{status: "BLOCK", reasonCode: "SANCTIONS_CONFIRMED"}',
          'Case Disposition':
            '{action: "BLOCK", queue: "SANCTIONS", slaHours: 0, reasonCode: "SANCTIONS_CONFIRMED"}',
        },
      },
      {
        name: 'Structuring pattern into a high-risk jurisdiction, at night',
        inputs: {
          Transaction: {
            amount: n('9400'),
            currency: 'EUR',
            channel: 'WIRE',
            timestamp: dt('2026-03-11T03:20:00'),
            merchantCategory: 'MONEY_TRANSFER',
            cardPresent: false,
            counterpartyCountry: 'SY',
          },
          Customer: {
            accountAgeDays: n('21'),
            riskRating: 'HIGH',
            isPEP: false,
            sanctionsScreening: 'CLEAR',
            homeCountry: 'PT',
          },
          Behaviour: {
            txCount24h: n('9'),
            txAmount24h: n('27000'),
            distinctCountries7d: n('5'),
            priorConfirmedFraud: n('0'),
            averageTicket90d: n('120'),
          },
          'High Risk Countries': ['IR', 'KP', 'SY'],
        },
        expect: {
          'Risk Factors':
            '{amount: 50, velocity: 32, geography: 50, profile: 35, channel: 33}',
          'Risk Score': '200',
          'Risk Band': '"CRITICAL"',
          'Case Disposition':
            '{action: "BLOCK", queue: "FRAUD_L2", slaHours: 2, reasonCode: "RISK_CRITICAL"}',
        },
      },
      {
        name: 'Politically exposed person with a moderate score',
        inputs: {
          Transaction: {
            amount: n('4200'),
            currency: 'EUR',
            channel: 'ONLINE',
            timestamp: dt('2026-03-11T11:00:00'),
            merchantCategory: 'JEWELLERY',
            cardPresent: false,
            counterpartyCountry: 'FR',
          },
          Customer: {
            accountAgeDays: n('900'),
            riskRating: 'MEDIUM',
            isPEP: true,
            sanctionsScreening: 'CLEAR',
            homeCountry: 'PT',
          },
          Behaviour: {
            txCount24h: n('2'),
            txAmount24h: n('4400'),
            distinctCountries7d: n('2'),
            priorConfirmedFraud: n('0'),
            averageTicket90d: n('400'),
          },
          'High Risk Countries': ['IR', 'KP', 'SY'],
        },
        expect: {
          'Screening Outcome': '{status: "ENHANCED_DUE_DILIGENCE", reasonCode: "PEP"}',
          'Risk Band': '"MEDIUM"',
          'Case Disposition':
            '{action: "REVIEW", queue: "COMPLIANCE_EDD", slaHours: 4, reasonCode: "PEP_ELEVATED_RISK"}',
        },
      },
    ],
  },

  '09-credit-decisioning': {
    title: 'Credit decisioning (whole model)',
    complexity: 'Complex',
    domain: 'Lending',
    summary: 'Evaluating the whole model runs the fallback bureau-score logic.',
    teaches: 'the baseline for the contrast in 09b',
    cases: [
      {
        name: 'Fallback score is computed from the applicant',
        inputs: {
          Applicant: {
            annualIncome: n('54000'),
            existingDebt: n('4000'),
            employmentYears: n('6'),
            missedPayments: n('0'),
          },
          Request: { amount: n('12000'), termMonths: n('48') },
        },
        // 650 + 6*10 - 0 = 710, so standard pricing.
        expect: {
          'Bureau Score': '710',
          'Credit Decision':
            '{outcome: "APPROVE", apr: 0.129, reason: "Standard pricing"}',
        },
      },
    ],
  },

  '09b-credit-service': {
    title: 'Credit decisioning (through the service)',
    complexity: 'Complex',
    domain: 'Lending',
    model: '09-credit-decisioning',
    service: 'Underwriting',
    summary:
      'The same model invoked as a decision service: Bureau Score is a ' +
      'parameter, so the fallback logic never runs.',
    teaches: 'decision-service encapsulation, and why it is not the same as evaluating a decision',
    cases: [
      {
        name: 'Caller supplies a real bureau score',
        inputs: {
          Applicant: {
            annualIncome: n('54000'),
            existingDebt: n('4000'),
            employmentYears: n('6'),
            missedPayments: n('0'),
          },
          Request: { amount: n('12000'), termMonths: n('48') },
          // The same applicant whose fallback would have been 710.
          'Bureau Score': n('770'),
        },
        expect: {
          'Credit Decision': '{outcome: "APPROVE", apr: 0.079, reason: "Prime pricing"}',
        },
      },
      {
        name: 'Affordability fails regardless of a prime score',
        inputs: {
          Applicant: {
            annualIncome: n('30000'),
            existingDebt: n('9000'),
            employmentYears: n('10'),
            missedPayments: n('0'),
          },
          Request: { amount: n('20000'), termMonths: n('36') },
          'Bureau Score': n('800'),
        },
        expect: {
          'Credit Decision':
            '{outcome: "DECLINE", apr: null, reason: "Debt to income above policy limit"}',
        },
      },
    ],
  },

  '10-customs-clearance': {
    title: 'Customs clearance',
    complexity: 'Complex',
    domain: 'International trade compliance',
    summary:
      'Duty components, ordered controls and a clearance route, from a ' +
      'commodity code and a licence.',
    teaches:
      'RULE ORDER, COLLECT SUM, nested contexts, string built-ins, ' +
      'temporal comparison, and a service with two output decisions',
    cases: [
      {
        name: 'Preferential machinery, nothing controlled',
        inputs: {
          Consignment: {
            commodityCode: '8471300000',
            customsValue: n('42000'),
            netMassKg: n('310'),
            originCountry: 'CH',
            isDualUse: false,
            isPerishable: false,
          },
          'Export Licence': null,
          'Declaration Date': d('2026-02-10'),
          'Preference Countries': ['CH', 'NO', 'IS'],
        },
        expect: {
          Classification: '{chapter: "84", preferential: true, excise: false}',
          'Licence Status': '"NOT_REQUIRED"',
          'Duty Components': '0',
          Controls: '[]',
          'Clearance Instruction':
            '{route: "GREEN", dutyPayable: 0, controlCount: 0, preferentialOrigin: true}',
        },
      },
      {
        name: 'Spirits: ad valorem plus excise, and a movement control',
        inputs: {
          Consignment: {
            commodityCode: '2208300000',
            customsValue: n('18000'),
            netMassKg: n('900'),
            originCountry: 'US',
            isDualUse: false,
            isPerishable: false,
          },
          'Export Licence': null,
          'Declaration Date': d('2026-02-10'),
          'Preference Countries': ['CH', 'NO', 'IS'],
        },
        // 18000 * 0.32 = 5760, plus 900 * 1.85 = 1665.
        expect: {
          'Duty Components': '7425',
          Controls: '["EXCISE_MOVEMENT_CONTROL"]',
          'Clearance Instruction':
            '{route: "ORANGE", dutyPayable: 7425, controlCount: 1, preferentialOrigin: false}',
        },
      },
      {
        name: 'Expired licence on a dual-use item stops everything',
        inputs: {
          Consignment: {
            commodityCode: '8471800000',
            customsValue: n('120000'),
            netMassKg: n('40'),
            originCountry: 'US',
            isDualUse: true,
            isPerishable: true,
          },
          'Export Licence': { reference: 'EL-2024-3391', expiryDate: d('2025-12-31') },
          'Declaration Date': d('2026-02-10'),
          'Preference Countries': ['CH', 'NO', 'IS'],
        },
        // Controls are collected in rule order, not by severity.
        expect: {
          'Licence Status': '"EXPIRED"',
          Controls: '["EXPORT_LICENCE_CONTROL", "SANITARY_INSPECTION"]',
          'Duty Components': '3490',
          'Clearance Instruction':
            '{route: "RED", dutyPayable: 3490, controlCount: 2, preferentialOrigin: false}',
        },
      },
    ],
  },
};

export { d, dt, n };
