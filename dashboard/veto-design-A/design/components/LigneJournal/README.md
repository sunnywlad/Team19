La ligne de journal rend la chaîne de preuve visible : chaque entrée est un maillon, liée à la précédente par une empreinte abrégée.

**Fournir** : l'heure, l'événement, l'acteur, l'empreinte de l'entrée et celle de la précédente. Pas de donnée nominative, pas de contenu de document : des identifiants opaques et des empreintes.

- Une colonne de maillons relie les lignes d'un trait vertical ; la lecture « chaque entrée tient la précédente » se fait sans connaître le hachage.
- Les empreintes sont abrégées (4 + 4 caractères) en `identifiant`. L'empreinte de l'entrée est en gras, celle qu'elle lie en `discret`.
- Une rupture change de forme, pas seulement de couleur : icône de maillon brisé, trait pointillé, contour orange et phrase en mots.
- Événements du journal : demande reçue, détection, demande analysée, transmise à l'IA du client, demande signée, mise en file, soumise, décision observée, quarantaine, agent en pause, alerte envoyée, rapport d'incident généré, décision humaine.
- Lisible par un auditeur non technique : la phrase d'une rupture dit ce qui est faux, pas comment le vérifier.
- Les empreintes de l'aperçu sont des exemples de forme.
