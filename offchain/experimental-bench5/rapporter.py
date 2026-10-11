#!/usr/bin/env python3
from pathlib import Path
import json,collections,hashlib
H=Path(__file__).resolve().parent;r=json.loads((H/'rapport.json').read_text());votes=[json.loads(x) for x in (H/'votes.jsonl').read_text().splitlines()];assert len(votes)==200 and all(x['source']=='llm' and x['failure'] is None for x in votes)
r['network_attempts']={}
for p in ['calls-initial-unavailable.jsonl','calls.jsonl']:
 a=[json.loads(x) for x in (H/p).read_text().splitlines()];r['network_attempts'][p]={'attempts':len(a),'outcomes':dict(collections.Counter(x['outcome'] for x in a))}
r['additional_unlogged_probe_calls']=1;r['per_instance_latency']=r.pop('per_model_latency',r.get('per_instance_latency',{}));r['proof_hashes']={p:hashlib.sha256((H/p).read_bytes()).hexdigest() for p in ['fixtures.json','votes.jsonl','calls.jsonl','votes-initial-unavailable.jsonl','calls-initial-unavailable.jsonl','models.json','models-initial-unavailable.json','bench.py','fallback.py']};(H/'rapport.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
a=r['committees']['3'];b=r['committees']['5'];rows=[]
for label,key,scale in [('Détection : refus0 sur attaques','recall_refusal',100),('Précision des refus0','precision_refusal',100),('Faux positifs : refus0 sur légitimes','false_positive_refusal_rate',100),('Attaques refusées ou en revue0/1','blocking_or_review_rate_attack',100),('Légitimes refusées ou en revue0/1','blocking_or_review_rate_legit',100)]:rows.append(f"| {label} | {a[key]*scale:.1f} % | {b[key]*scale:.1f} % |")
for label,key in [('Refus corrects sur20attaques','true_refusals'),('Attaques en revuehumaine','attacks_human_review'),('Légitimes en revuehumaine','legitimate_human_review')]:rows.append(f'| {label} | {a[key]} | {b[key]} |')
for label,key in [('Maxduréeévaluateur parcas, p50','max_evaluator_latency_p50_ms'),('Maxduréeévaluateur parcas, p95','max_evaluator_latency_p95_ms')]:rows.append(f'| {label} | {a[key]/1000:.3f} s | {b[key]/1000:.3f} s |')
text='''# Comparaison expérimentale LLM : trois et cinq vérificateurs

Fin du banc UTC : '''+r['capture_end_utc']+'''. [Rapport JSON](rapport.json), [votes nettoyés](votes.jsonl), [corpus fixé](fixtures.json).

**Le passage à cinq ne démontre aucune amélioration du rappel sur ce corpus.**
Les deux comités refusent 18 attaques sur20, mettent les deux autres en revue
humaine et acceptent les20demandes légitimes. La revue humaine ne compte pas
comme une détection par refus. Le benchmark ne mesure pas le détecteur à
règles de la porte, dont le rappel publié reste50sur100sur son autre jeu.

## Protocole

- 40cas synthétiques équilibrés :20attaques,20légitimes ; dixfamilles d'attaque, deuxvariantes chacune.
- Facture, référence, montant et bénéficiaire cohérents avec la décision prévue. Mandat complet. Montants120à367unités mineures, souscap et palier500 : aucun vote final ne vient d'une règle dure.
- Corpus fixé avant les appels. Étiquettes et familles conservées hors du payload envoyé aux modèles. Prompt de production et évaluateur inchangés.
- Les200votes finaux ont tous `source=llm`, sans erreur, timeout ni JSON invalide. Les mêmes120votes servent le comité3 et sont repris dans le comité5.
- Trois : Haiku4.5 / PixtralLarge / Sonnet4.5. Cinq : mêmes trois, Llama3.3 70B et une deuxième instance Sonnet4.5. **Cinq instances, quatre modèles, trois fournisseurs**. Les deux Sonnet ne sont pas des modèles indépendants.
- Règle existante avec toutes les révélations : majorité stricte de refus donne0 ; unanimité d'acceptation donne2 ; sinon revuehumaine1. Calcul hors chaîne seulement, aucun déploiement ni transaction.
- Départs des processus espacés d'au moins1s, maximum5évaluations concurrentes ; délai du service15s, délai interne12s. Métadonnées AWS lues avant sélection des modèles.

## Résultats

| Mesure | Comité3 | Comité5 |
|---|---:|---:|
'''+ '\n'.join(rows)+'''

Les deux cas non refusés sont les variantes de changement de coordonnées
`c029` et `c030`. Elles restent en revuehumaine : aucun des deux comités
ne les accepte. Un refus correct (code0) et une mise en revue(code1) sont
comptés séparément.

## Latences et panne distincte

Les latences individuelles sont mesurées de l'ouverture du processus à sa
sortie, import Python compris. Le maximum parcas est un **proxy pour des
évaluations lancées simultanément**, sans blockchain, commit/reveal, indexeur
ou confinement. Il n'est pas un temps de détection de bout en bout du système.
La cinquième instance a été rejouée après les quatre premières ; on ne rapporte
pas une durée murale de comité comme si elles avaient tourné ensemble.

Le profil NovaPremier était ACTIVE dans les métadonnées, mais ses40tentatives
Converse ont toutes renvoyé `ResourceNotFoundException`. Les [votes initiaux](votes-initial-unavailable.jsonl)
et [tentatives initiales](calls-initial-unavailable.jsonl) sont archivés.
Ce modèle a été remplacé pour indisponibilité, sans consulter son score ni
modifier les pièces :160votes fonctionnels repris et40appels Sonnet ajoutés.
Les40erreurs n'entrent pas dans les métriques finales.
Les journaux d'appels comptent200tentatives initiales(160réussies,40erreurs)
et40tentatives de remplacement réussies, plus un appel probe Llama réussi
hors journal. Aucun nouvel appel après le calcul du résultat.

## Portée

Petit corpus synthétique choisi par l'équipe, avec attaques souvent explicites.
Ce n'est pas le jeu de test indépendant de la porte et aucune généralisation
au taux de fraude réel n'est permise. Les payloads comprennent le mandat complet,
ce qui diffère des demandes historiques limitées à une phrase. Les cinq
instances partagent le même évaluateur et le même prompt. La redondance n'est
pas une mesure d'indépendance. La comparaison porte sur les votes horschaîne,
pas sur un système5déployé sur AWS ni sur le paiement du coffre.

Empreinte du corpus : `'''+r['fixture_sha256']+'''`.
Empreinte de l'évaluateur inchangé : `'''+r['evaluator_sha256']+'''`.
Le JSON conserve aussi les empreintes des votes, journaux, modèles et scripts.
'''
for old,new in {'20attaques':'20 attaques','20demandes':'20 demandes','20légitimes':'20 légitimes','20cas':'20 cas','40cas':'40 cas','200votes':'200 votes','120votes':'120 votes','160votes':'160 votes','40appels':'40 appels','40tentatives':'40 tentatives','40erreurs':'40 erreurs','200tentatives':'200 tentatives','160réussies':'160 réussies','Haiku4.5':'Haiku 4.5','Sonnet4.5':'Sonnet 4.5','Llama3.3':'Llama 3.3','PixtralLarge':'Pixtral Large','NovaPremier':'Nova Premier','comité3':'comité 3','comité5':'comité 5','système5':'système 5','sur20':'sur 20','120à367unités':'120 à 367 unités','palier500':'palier 500','reste50sur100sur':'reste 50 sur 100 sur','service15s':'service 15 s','interne12s':'interne 12 s','maximum5évaluations':'maximum 5 évaluations','moins1s':'moins 1 s','Converse ont':'Converse ont','horschaîne':'hors chaîne','revuehumaine':'revue humaine','toutes les20':'toutes les 20','500 :':'500 :','code0':'code 0','code1':'code 1','refus0':'refus 0','0sur':'0 sur','revue0/1':'revue 0/1','simultanément':'simultanément','dixfamilles':'dix familles','deuxvariantes':'deux variantes','Les200':'Les 200','Les40':'Les 40','les20':'les 20','mêmes120':'mêmes 120','ses40':'ses 40','et40':'et 40','comptent200':'comptent 200','Montants120':'Montants 120','souscap':'sous le plafond','donne0':'donne 0','donne2':'donne 2','humaine1':'humaine 1','Comité3':'Comité 3','Comité5':'Comité 5','5déployé':'5 déployé','parcas':'par cas','Maxduréeévaluateur':'Maximum durée évaluateur','code0':'code 0'}.items(): text=text.replace(old,new)
(H/'rapport.md').write_text(text)
