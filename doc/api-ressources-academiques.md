# Récupérer les ressources académiques — guide développeur

Ce guide explique comment lire les **épreuves**, les **concours** et les
**examens nationaux** depuis l'API, et comment récupérer les fichiers PDF
correspondants.

Il est écrit pour une intégration côté serveur — indexation, traitement par
lots, alimentation d'un moteur de recherche ou d'un modèle de langage — et non
pour une application cliente. Les conseils de la section 9 en tiennent compte.

Tous les échanges reproduits ici sont des réponses réelles de l'API.

---

## 1. Les trois ressources

| Ressource | Chemin | Contenu | Bénin | Tous pays |
|---|---|---|---|---|
| Épreuves | `/epreuves` | Sujets rattachés à une matière, elle-même rattachée à un niveau, une filière et un établissement | 2 989 | 3 161 |
| Concours | `/concours` | Sujets de concours, rattachés à une structure organisatrice et une année | 155 | 246 |
| Examens nationaux | `/examens-nationaux` | Sujets d'examens d'État (BAC, BEPC…), rattachés à un type, une série, une matière et une année | 4 | 4 |

Volumes relevés en production le 13 août 2026. L'écart entre les deux colonnes
rappelle qu'une indexation limitée au Bénin laisse de côté près de 300
documents.

Les trois sont des ressources distinctes avec leurs propres points d'entrée.
Un examen national n'apparaît **pas** dans `/epreuves` : ne cherchez pas à les
obtenir par un filtre de type.

---

## 2. Authentification et périmètre pays

Tous ces points d'entrée exigent un jeton JWT :

```
Authorization: Bearer <jeton>
```

Et un paramètre de pays sur toute lecture :

```
?country=benin
```

Pays configurés : `benin`, `senegal`, `congo`.

**Omettre `country` ne provoque pas d'erreur** : la requête est alors traitée
comme si vous aviez demandé le Bénin. C'est le piège le plus coûteux de cette
API pour une indexation — vous croiriez tout parcourir en n'obtenant qu'un
pays. Passez toujours le paramètre explicitement, et bouclez sur les trois
pays pour un parcours complet.

> Utilisez un compte de service dont le rôle **n'est pas** `étudiant`. La
> raison est expliquée en section 10 — elle touche aux statistiques, pas aux
> droits d'accès.

---

## 3. La forme des listes

Les trois listes partagent la même enveloppe :

```json
{
  "data": [ ... ],
  "total": 2688,
  "page": 1,
  "limit": 2,
  "totalPages": 1344
}
```

Paramètres communs :

| Paramètre | Défaut | Remarque |
|---|---|---|
| `page` | 1 | commence à 1, pas à 0 |
| `limit` | 10 | **aucune borne haute** — voir l'avertissement ci-dessous |
| `search` | — | recherche textuelle, portée variable selon la ressource |

Le tri, lui, n'est **pas** commun aux trois ressources, et son comportement
réel diffère de ce qu'annonce la documentation Swagger. Le tableau de la
section 7 le détaille ; lisez-le avant d'écrire une pagination.

**`limit` n'est pas plafonné.** `limit=1000` renvoie mille enregistrements en
une réponse, avec les objets imbriqués. C'est tentant pour une indexation, mais
la charge côté base et la taille de la réponse croissent d'autant. Une valeur
entre 100 et 200 est un bon compromis.

---

## 4. Épreuves

`GET /epreuves`

| Filtre | Type | Effet |
|---|---|---|
| `search` | texte | titre ou nom de matière, insensible aux accents et à la casse |
| `matiere` | texte | nom de la matière, **égalité stricte** |
| `type` | énumération | `Interrogation`, `Devoirs`, `Concours`, `Examens` |
| `sort_order` | `ASC` ou `DESC` | sur `date_creation`, `DESC` par défaut |

Le filtre `type` est tolérant à la casse : `examens` devient `Examens`.

`matiere` exige le nom **exact** : `matiere=BIOSTATISQUE` renvoie un résultat,
`matiere=biostat` aucun. Pour une recherche partielle, utilisez `search`.

Deux pièges vérifiés sur l'API :

- **`titre` est accepté mais sans effet.** Il figure dans le contrat, le service ne l'utilise pas : `titre=BIOSTATISQUE` renvoie les 2 688 épreuves. Utilisez `search`.
- **`sort_by` est refusé par un 400** (`property sort_by should not exist`), alors que la documentation Swagger l'annonce. Seul `sort_order` est accepté ici.

### Exemple de réponse

```json
{
  "id": 6,
  "uuid": "1431ba81-6a7f-4778-a136-985df9ccdf27",
  "titre": "BIOSTATISQUE — normal",
  "url": "https://storage.googleapis.com/…/biostatistique.pdf",
  "file_path": "/epreuves/1431ba81-6a7f-4778-a136-985df9ccdf27/file",
  "file_extension": "pdf",
  "duree_minutes": 120,
  "date_creation": "2026-01-13T07:32:13.743Z",
  "date_publication": "2021-01-01T08:00:00.000Z",
  "nombre_pages": 4,
  "nombre_telechargements": 573,
  "type": "Examens",
  "annee": null,
  "section": "normal",
  "professeur": null,
  "matiere": {
    "id": 10,
    "nom": "BIOSTATISQUE",
    "niveau_etude": {
      "id": 1912,
      "nom": "Licence 1",
      "filiere": {
        "id": 137,
        "nom": "Médecine Humaine",
        "etablissement": { "id": 38, "nom": "Faculté de Médecine (FM)" }
      }
    }
  }
}
```

La chaîne **matière → niveau → filière → établissement** est fournie
directement : c'est le contexte académique le plus utile pour indexer un
document, et il évite quatre appels supplémentaires.

`professeur` vaut `null` sauf si le déposant est réellement un enseignant. Ne
l'utilisez pas comme identité de l'auteur du document.

---

## 5. Concours

`GET /concours`

| Filtre | Type | Effet |
|---|---|---|
| `search` | texte | titre ou lieu |
| `annee` | entier | année du concours |
| `sort_by` | `annee` ou `titre` | tri, `titre` par défaut |
| `sort_order` | — | **accepté mais ignoré** : le tri est toujours croissant |

```json
{
  "id": 9,
  "uuid": "60430634-85e5-4420-9995-99de0be368e6",
  "titre": "1000 Tests Psychotechniques-Corrigé (Partie1)",
  "file_path": "/concours/60430634-85e5-4420-9995-99de0be368e6/file",
  "file_extension": "pdf",
  "pays": "benin",
  "annee": null,
  "lieu": "Bénin",
  "nombre_page": 83,
  "nombre_telechargements": 29025,
  "structure": null,
  "titre_ref": null,
  "date_creation": "2026-08-01T18:55:37.343Z"
}
```

Attention au singulier : ici le champ est `nombre_page`, alors que les épreuves
et les examens nationaux utilisent `nombre_pages`. Ce n'est pas une coquille de
ce guide.

`GET /concours/annees` renvoie la liste des années présentes, utile pour
découper une indexation :

```json
[2766, 2500, 2095, 2024, 2019, 2018, 2016, 2015, 2014, 2013]
```

Ces années viennent des données et ne sont pas toutes plausibles — `2766` est
une saisie erronée. Traitez ce champ comme une donnée déclarative, pas comme
une date de confiance.

---

## 6. Examens nationaux

`GET /examens-nationaux`

Les filtres sont ici des **identifiants numériques**, pas des noms :

| Filtre | Type | Effet |
|---|---|---|
| `search` | texte | titre |
| `type_examen` | entier | identifiant du type (BAC, BEPC…) |
| `serie` | entier | identifiant de la série |
| `matiere_examen` | entier | identifiant de la matière |
| `filiere_examen` | entier | identifiant de la filière |
| `annee` | entier | année de session |

`sort_by` est ici aussi **refusé par un 400**, et `sort_order` est accepté sans
avoir d'effet observable : l'ordre reste celui de `date_creation` décroissant.

```json
{
  "id": 33,
  "uuid": "423a8f48-c03a-4fba-aa98-c8bee841f743",
  "pays": "benin",
  "titre": "BAC - C - Physique-Chimie - 2025",
  "section": "Normal",
  "annee": 2025,
  "file_path": "/examens_nationaux/423a8f48-c03a-4fba-aa98-c8bee841f743/file",
  "file_extension": "pdf",
  "url": "",
  "type_examen_id": 1,
  "serie_id": 2,
  "matiere_examen_id": 9,
  "filiere_examen_id": null,
  "type_examen": { "id": 1, "nom": "BAC", "uuid": "c5e3fd1c-…" },
  "serie": { "id": 2, "nom": "C", "type_examen_id": 1 },
  "matiere_examen": { "id": 9, "nom": "Physique-Chimie", "type_examen_id": 1 },
  "filiere_examen": null
}
```

Chaque référence est fournie deux fois : l'identifiant brut (`serie_id`) et
l'objet complet (`serie`). Indexez le nom, filtrez sur l'identifiant.

`GET /examens-nationaux/annees` renvoie les années disponibles :

```json
[2025, 2024, 2023, 2022]
```

Le champ `url` est **vide** pour ces ressources : elles n'ont jamais existé sur
l'ancien stockage. Seul `file_path` fait foi.

---

## 7. Le tri, ressource par ressource

Le contrat Swagger et le comportement réel divergent. Voici ce que l'API fait,
vérifié appel par appel :

| | Épreuves | Concours | Examens nationaux |
|---|---|---|---|
| `sort_by` | **400** — refusé | `annee` ou `titre` | **400** — refusé |
| `sort_order` | fonctionne, sur `date_creation` | accepté, **sans effet** | accepté, **sans effet** |
| Ordre par défaut | `date_creation` décroissant | `titre` croissant | `date_creation` décroissant |

Conséquence pour une indexation : **seules les épreuves permettent de choisir
le sens du parcours.** Pour les deux autres ressources, l'ordre est imposé ;
si vous avez besoin d'un incrémental par date, triez côté client après avoir
tout récupéré — les volumes le permettent largement (71 et 22 éléments).

---

## 8. Récupérer le PDF

Deux voies existent. Elles ne se valent pas.

| | Lien signé (recommandé) | Téléchargement proxifié |
|---|---|---|
| Point d'entrée | `GET /files/{entite}/{uuid}/file/download-url` | `GET /epreuves/{id}/telechargement` |
| Identifiant | `uuid` | `id` numérique |
| Réponse | une URL temporaire, à télécharger directement | les octets du PDF |
| Charge serveur | nulle, le stockage sert le fichier | le serveur relaie tout le fichier |
| Examens nationaux | oui | **inexistant** |
| Effet de bord | aucun | écrit une ligne dans le journal des consultations |

### La voie recommandée

```
GET /files/epreuves/1431ba81-6a7f-4778-a136-985df9ccdf27/file/download-url?country=benin
```

```json
{
  "method": "GET",
  "path": "/epreuves/1431ba81-6a7f-4778-a136-985df9ccdf27/file",
  "extension": "pdf",
  "expires_in": 3600,
  "public": false,
  "url": "https://<compte>.r2.cloudflarestorage.com/epreuves/1431ba81-…/file.pdf?X-Amz-Signature=<REDACTED>&…"
}
```

L'URL renvoyée est valable **une heure** (`expires_in`) et ne demande aucune
authentification : un simple `GET` suffit. Ne la stockez pas — demandez-en une
juste avant de télécharger.

### Le nom d'entité n'est pas le chemin de l'API

C'est le piège le plus fréquent :

| Ressource | Chemin de l'API | Nom d'entité pour les fichiers |
|---|---|---|
| Épreuves | `/epreuves` | `epreuves` |
| Concours | `/concours` | `concours` |
| Examens nationaux | `/examens-nationaux` (tiret) | `examens_nationaux` (**tiret bas**) |

Le nom d'entité est aussi le premier segment de `file_path` : en cas de doute,
lisez-le dans la réponse plutôt que de le reconstruire.

### La voie proxifiée

`GET /epreuves/{id}/telechargement` et `GET /concours/{id}/telechargement`
renvoient directement le PDF :

```
200 · application/pdf · 1 042 706 octets
```

Elle reste utile pour un test rapide, mais fait transiter chaque fichier par le
serveur applicatif — et elle a un effet de bord décrit à la section 9.

---

## 9. Parcourir l'ensemble d'une ressource

```python
import requests

BASE = "https://api.educ-prime.com"
HEADERS = {"Authorization": f"Bearer {JETON}"}


def lister(ressource: str, pays: str, taille: int = 150, **filtres):
    """Parcourt une ressource page par page et rend chaque enregistrement."""
    page = 1
    while True:
        reponse = requests.get(
            f"{BASE}/{ressource}",
            headers=HEADERS,
            params={"country": pays, "page": page, "limit": taille, **filtres},
            timeout=60,
        )
        reponse.raise_for_status()
        corps = reponse.json()

        for element in corps["data"]:
            yield element

        if page >= corps["totalPages"]:
            return
        page += 1


def telecharger(entite: str, uuid: str, pays: str) -> bytes:
    """Demande un lien signé puis récupère le PDF depuis le stockage."""
    lien = requests.get(
        f"{BASE}/files/{entite}/{uuid}/file/download-url",
        headers=HEADERS,
        params={"country": pays},
        timeout=30,
    )
    lien.raise_for_status()

    # Le lien expire en une heure : on l'utilise immédiatement.
    fichier = requests.get(lien.json()["url"], timeout=120)
    fichier.raise_for_status()
    return fichier.content


# Le nom d'entité diffère du chemin de l'API pour les examens nationaux.
ENTITES = {
    "epreuves": "epreuves",
    "concours": "concours",
    "examens-nationaux": "examens_nationaux",
}

for ressource, entite in ENTITES.items():
    for element in lister(ressource, "benin"):
        if not element.get("file_path"):
            continue  # ressource sans fichier attaché
        pdf = telecharger(entite, element["uuid"], "benin")
        traiter(element, pdf)
```

Quelques principes qui évitent des ennuis :

- **Dédoublonnez sur `uuid`**, jamais sur `id` : les identifiants numériques sont propres à chaque ressource et se recoupent d'une table à l'autre.
- **Reprenez l'incrémental sur `date_creation`**, en triant par ce champ en ordre décroissant et en vous arrêtant au dernier horodatage déjà traité.
- **Vérifiez `file_path` avant de télécharger** : une ressource peut exister sans fichier attaché, la valeur est alors vide ou absente.
- **Ne présumez pas de `nombre_pages`** : la valeur est déclarative et vaut souvent `0`. Comptez les pages du PDF si le chiffre vous importe.
- **Une pagination profonde n'est pas figée** : un ajout pendant le parcours décale les pages. Pour une indexation complète, triez par `date_creation` en ordre croissant plutôt que par pertinence.

---

## 10. Deux effets de bord à connaître

### Le téléchargement proxifié fausse les statistiques

`GET /epreuves/{id}/telechargement` et son équivalent concours écrivent une
ligne dans le journal des consultations à chaque appel. Ce journal alimente
l'indicateur **« Apprenants actifs »** du tableau de bord.

Une indexation qui télécharge 2 700 épreuves par cette voie y inscrirait 2 700
consultations. L'indicateur ne compte que les comptes de rôle `étudiant` : un
compte de service avec un autre rôle ne le fausse donc pas. C'est la raison
pour laquelle la section 2 recommande de ne pas indexer sous une identité
d'étudiant.

Le lien signé, lui, n'écrit rien.

### Le champ `url` est un vestige

Il pointe vers l'ancien stockage Firebase, conservé pendant la migration. Il
est vide pour les examens nationaux et disparaîtra. **Utilisez `file_path` et
les liens signés** ; ne construisez jamais une URL de fichier à la main.

---

## 11. Récapitulatif

| Besoin | Requête |
|---|---|
| Lister les épreuves | `GET /epreuves?country=benin&page=1&limit=150` |
| Filtrer par matière | `GET /epreuves?country=benin&matiere=BIOSTATISQUE` |
| Filtrer par type | `GET /epreuves?country=benin&type=Examens` |
| Lister les concours | `GET /concours?country=benin&sort_by=annee` |
| Années de concours | `GET /concours/annees?country=benin` |
| Lister les examens nationaux | `GET /examens-nationaux?country=benin&annee=2025` |
| Filtrer par type et série | `GET /examens-nationaux?country=benin&type_examen=1&serie=2` |
| Années d'examens | `GET /examens-nationaux/annees?country=benin` |
| Détail d'une ressource | `GET /{ressource}/{id}?country=benin` |
| Lien de téléchargement | `GET /files/{entite}/{uuid}/file/download-url?country=benin` |

Tout appel exige l'en-tête `Authorization` et le paramètre `country`.
