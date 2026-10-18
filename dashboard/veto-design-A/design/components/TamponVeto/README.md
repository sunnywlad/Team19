Le tampon de veto marque un refus : un ovale orange posé en biais, le mot VETO et le code motif.

**Fournir** : le code motif réel du contrat (`INVOICE_UNKNOWN`, `INVOICE_ALREADY_PAID`, `REQUEST_REPLAYED`, `APPROVAL_TIMEOUT`, `AGENT_NOT_AUTHORIZED`…). Pas de motif lu : pas de tampon.

- Fort mais pas alarmiste : un aplat `refuse-fond`, un filet `refuse-signal`, l'encre `refuse`. Pas de rouge vif, pas de clignotement.
- Le tampon n'est jamais animé en boucle. Il se pose une fois (`tampon-nouveau`, `duree-veto`) sur un changement d'état réel.
- Avec `prefers-reduced-motion`, il apparaît posé, sans mouvement.
- Un veto qui tombe se lit en trois endroits qui disent la même chose : le siège levé, ce tampon, la pastille 0.
