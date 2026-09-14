# Dashboard personnel mobile

Ce guide explique comment intégrer les KPI personnels affichés à l'utilisateur
connecté dans l'application mobile.

## Endpoint

```http
GET /dashboard/moi/activite?jours=28
Authorization: Bearer <access_token>
```

`jours` règle la profondeur de la série journalière, entre 1 et 365. Sans
`jours`, le serveur renvoie 28 jours.

Le mobile n'envoie ni `country`, ni `utilisateur_id`. L'identité vient toujours
du JWT (`Authorization: Bearer ...`) et les KPI sont ceux de cet utilisateur,
pas ceux d'un pays ni ceux du dashboard admin.

Les compteurs personnels sont filtrés uniquement par `utilisateur_id`. Le pays
du compte (`utilisateurs.pays`) sert seulement à charger les règles de quota
applicables au compte.

## Quand l'app doit l'appeler

Appelez cette route après `POST /auth/connexion`, puis à chaque ouverture du
dashboard personnel ou après une action qui peut changer les compteurs :

- téléchargement/consultation d'une épreuve ;
- consultation d'un examen national ;
- ouverture d'un concours ;
- soumission d'une épreuve ;
- consommation d'un quota Ketsia.

## Réponse

```json
{
  "jours": [
    { "date": "2026-09-08", "acces": 0 },
    { "date": "2026-09-09", "acces": 2 }
  ],
  "streak_jours": 1,
  "derniere_connexion": "2026-09-14T09:05:55.527Z",

  "epreuves_consultees": 3,
  "examens_nationaux_consultes": 0,
  "concours_consultes": 0,
  "ressources_academiques_consultees": 3,
  "soumissions": 22,

  "kpis": {
    "epreuves_consultees": 3,
    "examens_nationaux_consultes": 0,
    "concours_consultes": 0,
    "ressources_academiques_consultees": 3,

    "quota_ressources_utilise": 0,
    "quota_ressources_restant": 5,
    "quota_ressources_pourcentage": 0,

    "quota_ketsia_utilise": 0,
    "quota_ketsia_restant": 1,
    "quota_ketsia_pourcentage": 0,

    "soumissions": 22,
    "streak_jours": 1,
    "derniere_connexion": "2026-09-14T09:05:55.527Z"
  },

  "quotas": {
    "RESOURCE_VIEW": {
      "used": 0,
      "limit": 5,
      "remaining": 5,
      "pourcentage": 0,
      "est_actif": false,
      "periode_reset": "MENSUEL",
      "reinitialisation": "2026-10-01T00:00:00Z"
    },
    "KETSIA_AI": {
      "used": 0,
      "limit": 1,
      "remaining": 1,
      "pourcentage": 0,
      "est_actif": false,
      "periode_reset": "MENSUEL",
      "reinitialisation": "2026-10-01T00:00:00Z"
    }
  }
}
```

## Champs à afficher

`kpis.epreuves_consultees` : nombre d'épreuves distinctes consultées par
l'utilisateur actif.

`kpis.examens_nationaux_consultes` : nombre d'examens nationaux distincts
consultés par l'utilisateur actif.

`kpis.concours_consultes` : nombre de concours distincts ouverts par
l'utilisateur actif.

`kpis.ressources_academiques_consultees` : total distinct
`épreuves + examens nationaux + concours`.

`kpis.quota_ressources_utilise` : nombre de ressources décomptées dans le quota
gratuit commun aux épreuves et examens nationaux.

`kpis.quota_ressources_restant` : unités restantes avant blocage, si le quota
est actif.

`kpis.quota_ressources_pourcentage` : progression entre 0 et 100.

`kpis.quota_ketsia_utilise`, `kpis.quota_ketsia_restant`,
`kpis.quota_ketsia_pourcentage` : même logique pour les lancements Ketsia.

`kpis.soumissions` : nombre d'épreuves soumises par l'utilisateur actif.

`kpis.streak_jours` : nombre de jours consécutifs avec au moins une connexion.
La série reste vivante si la dernière connexion date d'aujourd'hui ou d'hier.

`kpis.derniere_connexion` : dernière connexion connue de l'utilisateur.

## Rétrocompatibilité

Les champs historiques restent disponibles au premier niveau :

```json
{
  "jours": [],
  "streak_jours": 1,
  "derniere_connexion": "...",
  "epreuves_consultees": 3,
  "soumissions": 22
}
```

Les nouvelles intégrations doivent préférer `kpis`, mais un ancien client qui
lit les champs historiques continue de fonctionner.

## Points métier importants

Les compteurs de consultation (`epreuves_consultees`,
`examens_nationaux_consultes`, `concours_consultes`,
`ressources_academiques_consultees`) sont des compteurs distincts all-time par
utilisateur. Ils ne se remettent pas à zéro chaque mois.

Les quotas viennent de `quota_consommations`. Ils suivent leur propre période,
par exemple `MENSUEL`, et peuvent donc revenir à zéro alors que les compteurs de
consultation restent inchangés.

Quand `quotas.RESOURCE_VIEW.est_actif` ou `quotas.KETSIA_AI.est_actif` vaut
`false`, le quota est désactivé par l'administration. Le mobile peut afficher
les limites, mais ne doit pas présenter l'utilisateur comme bloqué.

Le quota `RESOURCE_VIEW` est commun aux épreuves et examens nationaux. Les
concours ne consomment pas ce quota gratuit.

`jours[].acces` compte les accès journalisés dans `resource_access` pour la
fenêtre demandée. Il sert à une heatmap ou une courbe d'activité, pas à calculer
les quotas.
