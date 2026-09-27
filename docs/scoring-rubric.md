# Framework scoring correction

The original free scorer assigned 4 for narrow phrase-pair matches, left Professional Speech Excellence permanently null, and only scored Language Accuracy when an error matched. This missed usable evidence in accepted conversations.

`domain.assessEvidence` now applies the same transparent provisional rubric to every accepted text or voice transcript. All six capability names and all seven IMPACT+R definitions remain canonical. Each dimension records demonstrated and missing criteria, supporting quotations and turn IDs, scope, method, framework version and scoring version.

Behavioural ratings: 1 = explicit counter-evidence without supporting behaviour; 2 = one demonstrated criterion or mixed counter-evidence; 3 = two criteria; 4 = three criteria or all four in a single response; 5 = all four demonstrated across multiple responses. No matched behaviour remains null rather than receiving an invented neutral score. Isolated keyword lists, empty and rejected responses are unscored. These rule-based estimates require human calibration; they are not a comprehensive semantic assessment.

Language Accuracy uses complete accepted transcript statements and the existing agreement, redundancy and sentence-construction checks. It now scores positive language evidence too. Professional Speech Excellence has a clearly labelled **content-only** provisional rating for understandable statements, concision, professional wording and organization. Neither content metric exceeds 4 automatically. Pronunciation, pace, pauses, vocal confidence and acoustic delivery remain unassessed without recording review; `deliveryScore` stays null.

The same rubric serves phase six, saved assessments, participant profiles and facilitator review. A scoring-version migration recomputes old machine ratings from saved accepted responses and keeps previous ratings in `scoreHistory`. Human-approved scores and review metadata are preserved.

UI reference lock: the user's supplied screenshot and existing TrustBuilder result cards define the layout: six capability cards on the left, seven IMPACT+R cards on the right, white surfaces, teal score markers, existing typography and borders. Refero craft guidance contributes keyboard focus and native disclosure controls. Keep numerical ratings, evidence and explanations together; no new theme or media assets.
