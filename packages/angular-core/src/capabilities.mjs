/**
 * SAC Core: read-only capability eligibility and explainability.
 *
 * A profile capability is a declaration, NOT a proven tool installation,
 * permission grant, runtime result, compiler certification or deploy gate.
 * Rule descriptors are already validated and registered by RuleRegistry.
 * No project source is executed, no filesystem or network access occurs.
 */
const compare=(a,b)=>a<b?-1:a>b?1:0;

export function assessRuleApplicability(profile,rule){
  const when=rule.applies_when;
  const missing=when.capabilities.filter(name=>!profile.capabilities.includes(name)).sort(compare);
  const modeMatched=!when.modes.length||when.modes.includes(profile.mode);
  const angularMajor=Number(profile.angular_version?.split('.')[0]);
  const majorMatched=!when.angular_majors.length||when.angular_majors.includes(angularMajor);
  const matches=!missing.length&&modeMatched&&majorMatched;
  return {
    matches,
    missing_capabilities:missing,
    reason:missing.length?'missing-declared-capability':
      !modeMatched?'mode-not-applicable':
      !majorMatched?'angular-major-not-applicable':'profile-conditions-match'
  };
}

export function describeSACCapabilities({profile,registeredRules}){
  // Called by the validated Core registry; never inspect arbitrary code.
  const entries=new Map(registeredRules.map(r=>[r.rule_id,r]));
  const rules=[...profile.rules].sort((a,b)=>compare(a.rule_id,b.rule_id)).map(selection=>{
    const rule=entries.get(selection.rule_id);
    if(!rule||rule.version!==selection.version){
      return {
        rule_id:selection.rule_id,
        eligibility:'unverified',reason:rule?'rule-version-mismatch':'rule-not-registered',
        required_capabilities:[],missing_capabilities:[]
      };
    }
    const decision=assessRuleApplicability(profile,rule);
    return {
      rule_id:rule.rule_id,
      eligibility:decision.matches?'eligible-by-profile':'not-applicable',
      reason:decision.reason,
      required_capabilities:[...rule.applies_when.capabilities].sort(compare),
      missing_capabilities:decision.missing_capabilities
    };
  });
  return {
    schema_version:1,kind:'sac-capabilities',
    scope:'profile-declarations-and-registered-rule-eligibility-only',
    status:'unverified',
    declared_capabilities:[...profile.capabilities].sort(compare),
    selected_rules:rules,
    rule_counts:{
      selected:rules.length,
      eligible_by_profile:rules.filter(r=>r.eligibility==='eligible-by-profile').length,
      not_applicable:rules.filter(r=>r.eligibility==='not-applicable').length,
      unverified:rules.filter(r=>r.eligibility==='unverified').length
    },
    tool_installation_verified:false,
    angular_cli_execution_verified:false,
    official_aot_verified:false,
    runtime_verified:false,
    deployment_authorized:false
  };
}
