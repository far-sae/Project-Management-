export function triggerConfigMatches(config: any, event: any): boolean {
  const payload = event.payload ?? {};
  if (event.event_type === 'deal_stage_entered') {
    return !config.stage_id || config.stage_id === payload.stage_id;
  }
  if (event.event_type === 'client_tagged') {
    return !config.tag || config.tag === payload.tag;
  }
  if (event.event_type === 'deal_score_band_changed') {
    return !config.band || config.band === payload.new_band;
  }
  return true;
}
