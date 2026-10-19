// Stage 2: compatibility research. Deterministic rule checks over a curated,
// source-cited component dataset (data/catalog/components.json). The rules
// only use specifications that cite a manufacturer document; anything not in
// the dataset returns "not found" with the specific missing detail instead of
// guessing.

export const BLOCKING_SLOTS = ['crankset', 'rear_derailleur', 'cassette', 'shifters', 'freehub'];

const SLOT_LABEL = {
  crankset: 'Crankset',
  rear_derailleur: 'Rear derailleur',
  cassette: 'Cassette',
  shifters: 'Shifters',
  chain: 'Chain',
  freehub: 'Freehub body',
};

const QUESTION = {
  rear_derailleur: {
    text: 'Which rear derailleur is fitted?',
    cageText: 'Which rear derailleur cage is fitted?',
    hint: 'Model code is printed on the back of the derailleur cage.',
  },
  crankset: { text: 'Which chainrings are fitted?', hint: 'Tooth counts are stamped on each ring.' },
  cassette: { text: 'Which cassette is fitted?', hint: 'Range is stamped on the largest cog.' },
  shifters: { text: 'Which shifters are fitted?', hint: 'Model code is under the hood, inboard side.' },
  freehub: { text: 'Which freehub body is on the rear wheel?', hint: 'Check the spline with the cassette off.' },
};

export function lowGear(crank, cassette) {
  const ring = crank.specs.smallRing;
  const cog = cassette.specs.largestCog;
  return { label: `${ring}×${cog}`, ratio: ring / cog };
}

// Required total capacity = front difference + rear difference (Shimano method).
export function capacityNeeded(crank, cassette) {
  return crank.specs.bigRing - crank.specs.smallRing + (cassette.specs.largestCog - cassette.specs.smallestCog);
}

export function checkCombo({ crank, rd, cassette, shifters, chain, freehub }, evidenceFor) {
  const checks = [];
  const push = (rule, pass, detail, ev = []) => checks.push({ rule, pass, detail, evidence_ids: ev });
  push(
    'speed_match',
    cassette.specs.speeds === shifters.specs.speeds && rd.specs.speeds === shifters.specs.speeds && (!chain || chain.specs.speeds === shifters.specs.speeds),
    `${shifters.specs.speeds}-speed shifters; cassette ${cassette.specs.speeds}-speed; derailleur ${rd.specs.speeds}-speed${chain ? `; chain ${chain.specs.speeds}-speed` : ''}`,
    [...evidenceFor(cassette), ...evidenceFor(rd), ...(chain ? evidenceFor(chain) : [])],
  );
  push(
    'shifter_family',
    rd.specs.shifterFamily === shifters.specs.shifterFamily,
    `Derailleur and shifters are both ${rd.specs.shifterFamily}`,
    [...evidenceFor(rd), ...evidenceFor(shifters)],
  );
  push(
    'min_low_sprocket',
    cassette.specs.largestCog >= rd.specs.minLowSprocket,
    `${rd.variant} needs a largest cog of at least ${rd.specs.minLowSprocket}T`,
    evidenceFor(rd),
  );
  push(
    'max_low_sprocket',
    cassette.specs.largestCog <= rd.specs.maxLowSprocket,
    `Largest cog ${cassette.specs.largestCog}T; ${rd.variant} allows up to ${rd.specs.maxLowSprocket}T`,
    evidenceFor(rd),
  );
  const need = capacityNeeded(crank, cassette);
  push(
    'total_capacity',
    need <= rd.specs.totalCapacity,
    `Needs ${need}T capacity (${crank.specs.bigRing}-${crank.specs.smallRing} front + ${cassette.specs.largestCog}-${cassette.specs.smallestCog} rear); ${rd.variant} has ${rd.specs.totalCapacity}T${need === rd.specs.totalCapacity ? ' (at the limit)' : ''}`,
    evidenceFor(rd),
  );
  push(
    'front_difference',
    crank.specs.bigRing - crank.specs.smallRing <= rd.specs.maxFrontDifference,
    `Front difference ${crank.specs.bigRing - crank.specs.smallRing}T; limit ${rd.specs.maxFrontDifference}T`,
    evidenceFor(rd),
  );
  const fit = cassette.specs.freehubFit?.[freehub.specs.spline];
  push(
    'freehub_fit',
    !!fit,
    fit ? (fit.spacer ? `Fits ${freehub.variant} with a ${fit.spacerLabel}` : `Fits ${freehub.variant}, no spacer`) : `Does not fit ${freehub.variant}`,
    [...evidenceFor(cassette), ...(fit?.evidenceIds || [])],
  );
  return { compatible: checks.every((c) => c.pass), checks, spacerPartId: fit?.spacer || null };
}

// The cited rules engine answers only when it can: an easier-gearing goal on
// a drivetrain made of verified catalog parts (or a recorded family hint for
// the one identifier it asks about). Everything else goes to AI research.
export function useRules(job, catalog) {
  const goal = job.constraints?.goalType;
  if (goal === 'unknown') return true; // rules path returns "describe the goal"
  if (goal !== 'easier_gearing') return false;
  return BLOCKING_SLOTS.every((slot) => {
    const c = job.configuration.components[slot];
    if (!c) return false;
    if (c.partId) return !!catalog[c.partId] && !catalog[c.partId].unverified;
    return !!c.familyHint;
  });
}

// Build the list of upgrade options (one per candidate cassette), each with
// the dependent derailleur and chain changes it requires.
export function research({ job, catalog, evidence }) {
  const comps = job.configuration.components;
  const evidenceFor = (part) => part?.evidenceIds || [];
  const questions = [];
  const notListed = BLOCKING_SLOTS.filter((slot) => comps[slot]?.status === 'confirmed' && catalog[comps[slot].partId]?.unverified);
  if (notListed.length) {
    return {
      schema: 'research.v1',
      job_id: job.id,
      configuration_version: job.configuration.version,
      goal: job.constraints?.goalType || 'unknown',
      observed: job.request?.extraction?.observed_conditions || [],
      inferred: [],
      evidence: [],
      status: 'not_found',
      questions: [],
      options: [],
      requirements: [],
      not_found: {
        reason: `No verified compatibility data for this ${notListed.map((x) => SLOT_LABEL[x].toLowerCase()).join(' and ')}.`,
        missing: notListed,
        next_steps: ['Confirm exact model codes', 'Try another configuration', 'Ask a supplier'],
      },
    };
  }
  for (const slot of BLOCKING_SLOTS) {
    const c = comps[slot];
    if (!c || c.status !== 'confirmed' || !c.partId) {
      questions.push({
        id: `q-${slot}`,
        slot,
        text: c?.status === 'needs_inspection' ? `${SLOT_LABEL[slot]} needs inspection before parts can be matched.` : (c?.familyHint && QUESTION[slot].cageText) || QUESTION[slot].text,
        hint: QUESTION[slot].hint,
        options: (catalog._choices?.[slot] || []).filter((id) => !c?.familyHint || catalog[id]?.family === c.familyHint || catalog[id]?.unverified).map((id) => ({ value: id, label: catalog[id].variant })),
        blocking: true,
        status: c?.status === 'needs_inspection' ? 'needs_inspection' : 'needs_confirmation',
      });
    }
  }
  const base = {
    schema: 'research.v1',
    engine: 'rules',
    job_id: job.id,
    configuration_version: job.configuration.version,
    goal: job.constraints?.goalType || 'unknown',
    observed: job.request?.extraction?.observed_conditions || [],
    inferred: [],
    evidence: [],
  };
  if (questions.length) {
    return { ...base, status: 'needs_info', questions, options: [], requirements: [] };
  }

  const crank = catalog[comps.crankset.partId];
  const rd = catalog[comps.rear_derailleur.partId];
  const cassette = catalog[comps.cassette.partId];
  const shifters = catalog[comps.shifters.partId];
  const chain = comps.chain?.partId ? catalog[comps.chain.partId] : null;
  const freehub = catalog[comps.freehub.partId];
  const unsupported = [crank, rd, cassette, shifters, freehub].filter((p) => !p || p.unverified);
  if (unsupported.length) {
    return {
      ...base,
      status: 'not_found',
      questions: [],
      options: [],
      requirements: [],
      not_found: {
        reason: 'No verified compatibility data for this drivetrain.',
        next_steps: ['Confirm exact model codes', 'Try another configuration', 'Ask a supplier'],
      },
    };
  }

  if (job.constraints?.goalType !== 'easier_gearing') {
    return {
      ...base,
      status: 'not_found',
      questions: [],
      options: [],
      requirements: [],
      not_found: { kind: 'goal', reason: 'Not sure what the customer wants yet.', detail: 'This prototype researches easier-gearing upgrades. Add the goal to the job description.', next_steps: ['Edit job description'] },
    };
  }

  const baseline = lowGear(crank, cassette);
  const options = [];
  const cassettes = Object.values(catalog).filter(
    (p) => p.slot === 'cassette' && !p.unverified && p.specs.speeds === shifters.specs.speeds && p.specs.largestCog > cassette.specs.largestCog,
  );
  const rds = Object.values(catalog).filter((p) => p.slot === 'rear_derailleur' && !p.unverified && p.specs.shifterFamily === shifters.specs.shifterFamily);
  const chains = Object.values(catalog).filter((p) => p.slot === 'chain' && !p.unverified && p.specs.speeds === shifters.specs.speeds);

  for (const cs of cassettes) {
    const withCurrent = checkCombo({ crank, rd, cassette: cs, shifters, freehub }, evidenceFor);
    let rdChoice = rd;
    let rdChange = null;
    let combo = withCurrent;
    const fitsFreehub = withCurrent.checks.find((c) => c.rule === 'freehub_fit').pass;
    if (!fitsFreehub) {
      options.push({ id: `opt-${cs.id}`, cassettePartId: cs.id, compatible: false, checks: withCurrent.checks, reason: 'Does not fit the freehub' });
      continue;
    }
    if (!withCurrent.compatible) {
      const fits = rds
        .filter((r) => r.id !== rd.id)
        .map((r) => ({ r, res: checkCombo({ crank, rd: r, cassette: cs, shifters, freehub }, evidenceFor) }))
        .filter((x) => x.res.compatible)
        .sort((a, b) => a.r.retailPrice - b.r.retailPrice);
      if (!fits.length) {
        options.push({ id: `opt-${cs.id}`, cassettePartId: cs.id, compatible: false, checks: withCurrent.checks, reason: 'No verified derailleur in catalog supports this cassette' });
        continue;
      }
      rdChoice = fits[0].r;
      rdChange = {
        requirementId: 'rear_derailleur',
        partId: rdChoice.id,
        why: withCurrent.checks.filter((c) => !c.pass).map((c) => c.detail),
      };
      combo = fits[0].res;
    }
    const low = lowGear(crank, cs);
    const pct = Math.round((1 - low.ratio / baseline.ratio) * 100);
    options.push({
      id: `opt-${cs.id}`,
      cassettePartId: cs.id,
      rearDerailleurPartId: rdChange ? rdChoice.id : null,
      spacerPartId: combo.spacerPartId,
      compatible: true,
      low_gear: low.label,
      pct_easier: pct,
      capacity_needed: capacityNeeded(crank, cs),
      checks: combo.checks,
      dependencies: [
        ...(rdChange ? [{ type: 'add', requirementId: 'rear_derailleur', partId: rdChoice.id, currentMaxCog: rd.specs.maxLowSprocket, reason: `Current ${rd.variant} limits the largest cog to ${rd.specs.maxLowSprocket}T` }] : []),
        ...(combo.spacerPartId ? [{ type: 'add', requirementId: 'spacer', partId: combo.spacerPartId, reason: 'Cassette needs a spacer on this freehub' }] : []),
        { type: 'add', requirementId: 'chain', reason: 'Chain length is set on the largest cog, so it must be re-sized' },
      ],
    });
  }

  const compatible = options.filter((o) => o.compatible);
  if (!compatible.length) {
    return {
      ...base,
      status: 'not_found',
      questions: [],
      options,
      requirements: [],
      baseline,
      not_found: { reason: 'No verified cassette in catalog gives an easier low gear with this setup.', next_steps: ['Try another configuration', 'Ask a supplier'] },
    };
  }
  // Recommended: the easiest compatible low gear. Ties broken by fewer changes.
  compatible.sort((a, b) => b.pct_easier - a.pct_easier || (a.rearDerailleurPartId ? 1 : 0) - (b.rearDerailleurPartId ? 1 : 0));
  const recommended = compatible[0];

  const evidenceIds = new Set();
  for (const o of compatible) for (const c of o.checks) c.evidence_ids.forEach((e) => evidenceIds.add(e));
  for (const ch of chains) evidenceFor(ch).forEach((e) => evidenceIds.add(e));

  return {
    ...base,
    status: 'ready',
    questions: [],
    baseline,
    options,
    recommended_option_id: recommended.id,
    chain_candidates: chains.map((c) => c.id),
    current_chain: chain?.id || null,
    inferred: [
      'Chain must be re-sized for a larger low cog (Shimano chain-length method). A new chain is shop practice, not a Shimano requirement, and not a wear diagnosis.',
    ],
    evidence: [...evidenceIds].map((id) => evidence[id]).filter(Boolean),
  };
}

// Build requirement rows for a chosen option. Requirements are what the
// mechanic sees; dependent rows appear or disappear with the cassette choice.
export function requirementsFor(result, optionId, catalog) {
  const opt = result.options.find((o) => o.id === optionId && o.compatible);
  if (!opt) return [];
  const cs = catalog[opt.cassettePartId];
  const capCheck = opt.checks.find((c) => c.rule === 'total_capacity');
  const reqs = [
    {
      id: 'cassette',
      slot: 'cassette',
      title: 'Cassette',
      kind: 'required',
      partId: cs.id,
      reason: `Low gear ${opt.low_gear}, about ${opt.pct_easier}% easier than now.`,
      checks: opt.checks,
      alternatives: result.options.filter((o) => o.compatible && o.id !== opt.id).map((o) => o.cassettePartId),
      skippable: false,
    },
  ];
  if (opt.rearDerailleurPartId) {
    const dep = opt.dependencies.find((d) => d.requirementId === 'rear_derailleur');
    reqs.push({
      id: 'rear_derailleur',
      slot: 'rear_derailleur',
      title: 'Rear derailleur',
      kind: 'required',
      dependencyOf: 'cassette',
      partId: opt.rearDerailleurPartId,
      reason: `Current derailleur tops out at ${dep.currentMaxCog}T.`,
      checks: opt.checks.filter((c) => ['min_low_sprocket', 'max_low_sprocket', 'total_capacity', 'front_difference', 'shifter_family', 'speed_match'].includes(c.rule)),
      alternatives: [],
      skippable: false,
    });
  }
  if (opt.spacerPartId) {
    const sp = catalog[opt.spacerPartId];
    reqs.push({
      id: 'spacer',
      slot: 'spacer',
      title: 'Cassette spacer',
      kind: 'required',
      dependencyOf: 'cassette',
      partId: sp.id,
      reason: 'Needed on this freehub. Skip if one comes with the cassette.',
      checks: opt.checks.filter((c) => c.rule === 'freehub_fit'),
      alternatives: [],
      skippable: true,
    });
  }
  const chainIds = result.chain_candidates || [];
  const chainRec = chainIds.map((id) => catalog[id]).sort((a, b) => (a.brand === 'Shimano' ? -1 : 1) - (b.brand === 'Shimano' ? -1 : 1))[0];
  if (chainRec) {
    reqs.push({
      id: 'chain',
      slot: 'chain',
      title: 'Chain',
      kind: 'recommended',
      dependencyOf: 'cassette',
      partId: chainRec.id,
      reason: 'Bigger cog means a longer chain. Skip to re-use and re-size.',
      checks: [
        { rule: 'speed_match', pass: true, detail: `${chainRec.specs.speeds}-speed chain for an ${chainRec.specs.speeds}-speed drivetrain`, evidence_ids: chainRec.evidenceIds },
        { rule: 'chain_length', pass: true, detail: 'Size on largest chainring + largest cog, then add links per Shimano manual', evidence_ids: ['ev-dm-rard001'] },
      ],
      alternatives: chainIds.filter((id) => id !== chainRec.id),
      skippable: true,
    });
  }
  if (capCheck && /at the limit/.test(capCheck.detail)) reqs[0].reason += ' Uses full derailleur capacity.';
  return reqs;
}
