# Fondations visuelles

## Couleur

Deux thèmes pensés pour des heures d'écran, `light` et `dark`, mêmes noms, mêmes rôles. Le fond clair est un lilas gris (`fond`), le fond sombre l'aubergine nuit de la marque (`fond` sombre = `#1e1730`). La crème de la marque n'existe qu'en `papier` (rapports, diapositives claires) : elle ne sert pas de fond d'écran, pour éviter une palette beige.

Trois accents réservés au sens, chacun en trois versions :

| Sens | Encre (texte, icône) | Aplat (marque, glyphe dessus) | Fond de pastille |
|---|---|---|---|
| Payé, sain | `accepte` | `accepte-signal` | `accepte-fond` |
| Attente humaine | `humain` | `humain-signal` | `humain-fond` |
| Veto, refus, incident | `refuse` | `refuse-signal` | `refuse-fond` |

Le texte ne se pose jamais sur un aplat `-signal` : seules des icônes y vont, en `sur-signal`. Sarcelle et orange diffèrent par leur teinte sur l'axe bleu-vert / orange, pas sur l'axe rouge-vert, et chaque statut a son glyphe et son mot. Le bleu `simulation` complète l'ensemble sans entrer en conflit avec les trois accents.

Contrastes calculés (WCAG 2, texte 4,5:1 minimum, marques 3:1) :

| Paire | Clair | Sombre |
|---|---|---|
| `texte` sur `fond` | 14,6:1 | 14,4:1 |
| `texte` sur `surface` | 16,3:1 | 13,2:1 |
| `discret` sur `fond` | 6,6:1 | 8,7:1 |
| `discret` sur `surface` | 7,3:1 | 7,9:1 |
| `accent` sur `surface` | 13,5:1 | 8,3:1 |
| `accepte` sur `surface` | 6,9:1 | 9,1:1 |
| `humain` sur `surface` | 7,8:1 | 9,7:1 |
| `refuse` sur `surface` | 6,8:1 | 7,8:1 |
| `accepte` sur `accepte-fond` | 6,2:1 | 7,2:1 |
| `humain` sur `humain-fond` | 7,2:1 | 8,0:1 |
| `refuse` sur `refuse-fond` | 5,8:1 | 7,1:1 |
| `on-accent` sur `accent` | 11,9:1 | 9,1:1 |
| `entete-texte` sur `entete-fond` | 14,4:1 | 15,7:1 |

| Marque | Clair | Sombre |
|---|---|---|
| `accepte-signal` sur `surface` | 4,3:1 | 4,7:1 |
| `humain-signal` sur `surface` | 3,9:1 | 7,2:1 |
| `refuse-signal` sur `surface` | 3,7:1 | 4,7:1 |
| `trait-fort` sur `surface` | 4,1:1 | 4,3:1 |
| `focus` sur `surface` | 13,5:1 | 10,2:1 |
| `table` sur `surface` | 13,5:1 | 3,1:1 |
| `sur-signal` sur `accepte-signal` | 4,2:1 | 5,7:1 |
| `sur-signal` sur `humain-signal` | 4,5:1 | 8,6:1 |
| `sur-signal` sur `refuse-signal` | 4,9:1 | 5,7:1 |

Le violet de la marque `#2e1a6b` reste le `table` en clair. En sombre, `table` est relevé à `#7059d6` pour tenir 3:1 sur la surface. Les teintes du brief ont été ajustées : sarcelle `#2a9d8f` assombrie en clair (`#218576`) et moutarde `#e0a526` assombrie en clair (`#a97100`) pour atteindre 3:1 sur `fond`.

## Typographie

- **Jost** (OFL, fichiers locaux) pour les titres et le texte : géométrique, héritière de Futura, lisible en petit. Graisses 400, 500, 600, 700.
- **IBM Plex Mono** (OFL) pour tous les chiffres, identifiants, codes motif et empreintes : chasse fixe, chiffres tabulaires, zéro barré pour ne pas confondre 0 et O.
- Échelle : `display` 44/48, `titre-1` 32/38, `titre-2` 24/30, `titre-3` 18/24, `corps` 15/22, `corps-fort` 15/22 (500), `petit` 13/18, `legende` 12/16. Chiffres : `chiffre-xl` 56/60, `chiffre-lg` 40/44, `chiffre-md` 24/28, `identifiant` 13/18. Plancher : 12 px.
- Étiquettes (`etiquette`) : 12/16, graisse 600, capitales, interlettre 0,08 em.

## Espacement, rayons, élévation, grille

- Pas de 4 px : `espace-1` (4) à `espace-8` (64). Cartes à `espace-5` (24).
- Rayons : `rayon-xs` 4, `rayon-sm` 8, `rayon` 16, `rayon-lg` 24, `pilule` 999 (pastilles, boutons, étiquettes), `ovale` 50 % (tampon, table).
- Élévation : presque aucune. `relief` est un décalage plat de 2 px, `lueur` un anneau doux, réservé à la validation en attente. Pas de grande ombre floue sous une bordure fine.
- Grille : écran de 1440 px (`cadre-max`), gouttière `gouttiere` 24 px, deux colonnes 1,1 / 1 pour les panneaux, une colonne sous 1100 px. Tenu proprement jusqu'à `cadre-min` (1024 px). Mobile : alertes et validations seulement.
- Bande graphique fine (`.bande`) : deux filets de 2 px, héritage 60-70, une fois par écran, en tête.

## Mouvement

| Quoi | Durée | Courbe | Déclencheur |
|---|---|---|---|
| Un siège passe (couleur) | `duree-base` 240 ms | `courbe-sortie` | la couche a statué |
| Un veto : siège levé, tampon posé | `duree-veto` 320 ms | `courbe-sortie` | contrat ou porte refuse |
| Survol de bouton, d'onglet | `duree-rapide` 160 ms | `courbe-sortie` | action de l'utilisateur |

Ce qui ne bouge jamais : un statut qui attend (pas de pastille qui pulse), la lueur de la validation, la barre de trésorerie, le journal. `prefers-reduced-motion: reduce` supprime animations et transitions ; le siège en veto apparaît directement levé.

## Accessibilité

- WCAG 2.1 AA. Focus visible : anneau plein de 2 px en `focus`, décalé de 2 px, 3:1 sur toutes les surfaces ; dans la barre, `entete-accent`.
- Cibles : 24 px au minimum (`cible-min`), 32 px pour les boutons, 56 px pour la navigation.
- Un statut n'est jamais porté par la couleur seule : glyphe, mot, et forme (plein, hachuré, pointillé).
- Impression : tout se lit en niveaux de gris ; `RapportIncident` est conçu pour A4.
- Connexion par l'identité de l'entreprise (SSO) : pas de formulaire de mot de passe, pas de création de compte, pas d'écran de profil. Une page « Rôles », en lecture seule, montre qui détient quel pouvoir.
- L'échéance se lit en date et en heures, jamais en secondes : jauge de 24 cases (1/24 du délai), état « proche » dit en toutes lettres.
