"""QA (P4-01, P4-02): deterministic tier-1 checks. Every check returns one of three states and never guesses:
  passed       it ran, with the data it needs, and found nothing
  findings     it ran and found something (each finding has severity, place, evidence, likely cause, and a fix when one is safe)
  not-checked  it could not run, and says why (a missing input is never reported as a pass)
"""
