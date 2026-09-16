import { Injectable, NotFoundException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere, Brackets } from 'typeorm';
import { NiveauEtude } from './entities/niveau-etude.entity';
import { Filiere } from '../filieres/entities/filiere.entity';
import { CreerNiveauEtudeDto } from './dto/creer-niveau-etude.dto';
import { MajNiveauEtudeDto } from './dto/maj-niveau-etude.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginationResponse } from '../common/interfaces/pagination-response.interface';
import { FilterNiveauEtudeDto } from './dto/filter-niveau-etude.dto';
import { canoniserNiveau, memeNiveau } from './niveau-etude.canonique';

@Injectable()
export class NiveauEtudeService {
  private readonly logger = new Logger(NiveauEtudeService.name);

  constructor(
    @InjectRepository(NiveauEtude)
    private readonly niveauEtudeRepository: Repository<NiveauEtude>,
    @InjectRepository(Filiere)
    private readonly filieresRepository: Repository<Filiere>,
  ) { }

  // Note: `pays` (from @CurrentCountry) is intentionally ignored as the saved
  // value — it stays in the signature so the controller/middleware scoping is
  // unaffected, but the stored pays is DERIVED from the parent Filiere.
  async create(pays: string, creerNiveauEtudeDto: CreerNiveauEtudeDto) {
    this.logger.log(`Création d'un niveau d'étude: ${creerNiveauEtudeDto.nom} (Filière ID: ${creerNiveauEtudeDto.filiere_id})`);
    const filiere = await this.filieresRepository.findOne({
      where: { id: creerNiveauEtudeDto.filiere_id },
    });
    if (!filiere) {
      this.logger.warn(`Filière ID ${creerNiveauEtudeDto.filiere_id} introuvable`);
      throw new NotFoundException('Filière non trouvée');
    }

    // Le libellé vient d'une saisie libre — souvent celle d'un utilisateur qui
    // a proposé un niveau en soumettant une épreuve. « l1 » devient donc
    // « Licence 1 » ici, et non trois lignes plus tard dans une migration de
    // nettoyage.
    const nom = canoniserNiveau(creerNiveauEtudeDto.nom);
    if (nom !== creerNiveauEtudeDto.nom) {
      this.logger.log(`Libellé canonisé: « ${creerNiveauEtudeDto.nom} » → « ${nom} »`);
    }

    // Une filière ne doit pas proposer deux fois le même niveau : c'est ce qui
    // affiche « Licence 1 » en triple dans la liste déroulante. On rend la
    // ligne existante au lieu d'en ajouter une — la création reste ainsi
    // idempotente, ce qu'attend un appelant qui ignore si le niveau existe.
    const existant = await this.trouverEquivalent(creerNiveauEtudeDto.filiere_id, nom);
    if (existant) {
      this.logger.log(
        `Niveau « ${nom} » déjà présent sur la filière ${creerNiveauEtudeDto.filiere_id} ` +
          `(ID ${existant.id}) : réutilisé plutôt que dupliqué.`,
      );
      return existant;
    }

    const newNiveauEtude = this.niveauEtudeRepository.create({
      ...creerNiveauEtudeDto,
      nom,
      pays: filiere.pays,
    });
    const saved = await this.niveauEtudeRepository.save(newNiveauEtude);
    this.logger.log(`Niveau d'étude créé: ${saved.nom} (ID: ${saved.id}, pays: ${saved.pays})`);
    return saved;
  }

  /**
   * Le niveau déjà présent sur cette filière et désignant la même chose.
   *
   * La comparaison se fait en mémoire plutôt qu'en SQL : la canonisation vit
   * dans le code, et la dupliquer en SQL la ferait diverger au premier motif
   * ajouté. Une filière porte quelques niveaux, jamais des milliers.
   */
  private async trouverEquivalent(filiereId: number, nom: string) {
    const existants = await this.niveauEtudeRepository.find({ where: { filiere_id: filiereId } });
    return existants.find((n) => memeNiveau(n.nom, nom)) ?? null;
  }

  async findAll(pays: string, filterDto: FilterNiveauEtudeDto): Promise<PaginationResponse<any>> {
    const { page = 1, limit = 10, search, filiere } = filterDto;
    this.logger.log(`Récupération des niveaux d'étude (pays=${pays}) - Page: ${page}, Limite: ${limit}, Search: ${search}, Filière: ${filiere}`);

    const queryBuilder = this.niveauEtudeRepository.createQueryBuilder('niveau')
      .leftJoinAndSelect('niveau.filiere', 'filiere')
      .leftJoinAndSelect('filiere.etablissement', 'etablissement')
      .where('niveau.pays = :pays', { pays })
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('niveau.nom', filterDto.sort_order || 'ASC')

    if (filterDto.filiere_id) {
      queryBuilder.andWhere('filiere.id = :filiereId', { filiereId: filterDto.filiere_id });
    }

    // Insensible à la casse et aux accents : voir la note du DTO sur les noms
    // porteurs d'une apostrophe typographique.
    if (filiere) {
      queryBuilder.andWhere('unaccent(lower(filiere.nom)) = unaccent(lower(:filiere))', { filiere });
    }

    if (search) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where('unaccent(niveau.nom) ILIKE unaccent(:search)', { search: `%${search}%` })
            .orWhere('unaccent(filiere.nom) ILIKE unaccent(:search)', { search: `%${search}%` });
        }),
      );
    }

    const [niveaux, total] = await queryBuilder.getManyAndCount();

    this.logger.log(`${niveaux.length} niveau(x) d'étude trouvé(s) sur ${total} total`);

    // Transform to response DTO format
    const data = niveaux.map(niveau => ({
      id: niveau.id,
      nom: niveau.nom,
      duree_mois: niveau.duree_mois,
      filiere: {
        id: niveau.filiere.id,
        nom: niveau.filiere.nom,
        etablissement: niveau.filiere.etablissement,
      },
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    this.logger.log(`Recherche du niveau d'étude ID: ${id}`);
    const niveauEtude = await this.niveauEtudeRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['filiere', 'filiere.etablissement'],
    });

    if (!niveauEtude) {
      this.logger.warn(`Niveau d'étude ID ${id} introuvable`);
      throw new NotFoundException('Niveau d\'étude non trouvé');
    }

    this.logger.log(`Niveau d'étude trouvé: ${niveauEtude.nom} (ID: ${id})`);

    // Transform to response DTO format
    return {
      id: niveauEtude.id,
      nom: niveauEtude.nom,
      duree_mois: niveauEtude.duree_mois,
      filiere: {
        id: niveauEtude.filiere.id,
        nom: niveauEtude.filiere.nom,
        etablissement: niveauEtude.filiere.etablissement,
      },
    };
  }

  async update(id: string, majNiveauEtudeDto: MajNiveauEtudeDto) {
    this.logger.log(`Mise à jour du niveau d'étude ID: ${id}`);
    const niveauEtude = await this.niveauEtudeRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!niveauEtude) {
      this.logger.warn(`Niveau d'étude ID ${id} introuvable pour mise à jour`);
      throw new NotFoundException('Niveau d\'étude non trouvé');
    }

    // Si on met à jour la filière, re-dériver le pays du nouveau parent.
    let filiere = niveauEtude.filiere;
    let pays = niveauEtude.pays;
    if (majNiveauEtudeDto.filiere_id) {
      const parent = await this.filieresRepository.findOne({
        where: { id: majNiveauEtudeDto.filiere_id },
      });
      if (!parent) {
        this.logger.warn(`Filière ID ${majNiveauEtudeDto.filiere_id} introuvable`);
        throw new NotFoundException('Filière non trouvée');
      }
      filiere = { id: majNiveauEtudeDto.filiere_id } as any;
      pays = parent.pays;
    }

    // Même canonisation qu'à la création : renommer « Licence 1 » en « L1 »
    // depuis le back-office rouvrirait la porte qu'on vient de fermer.
    const nom =
      majNiveauEtudeDto.nom !== undefined
        ? canoniserNiveau(majNiveauEtudeDto.nom)
        : niveauEtude.nom;

    const updated = await this.niveauEtudeRepository.save({
      ...niveauEtude,
      ...majNiveauEtudeDto,
      nom,
      filiere,
      pays,
    });

    this.logger.log(`Niveau d'étude mis à jour: ${updated.nom}`);
    return updated;
  }

  async remove(id: string) {
    this.logger.log(`Suppression du niveau d'étude ID: ${id}`);
    try {
      const result = await this.niveauEtudeRepository.delete(id);
      if (result.affected === 0) {
        this.logger.warn(`Niveau d'étude ID ${id} introuvable pour suppression`);
        throw new NotFoundException('Niveau d\'étude non trouvé');
      }
      this.logger.log(`Niveau d'étude supprimé`);
      return { message: 'Niveau d\'étude supprimé avec succès' };
    } catch (error) {
      if (error.code === '23503') {
        throw new ConflictException('Impossible de supprimer ce niveau d\'étude car des matières y sont associées. Veuillez d\'abord supprimer les matières.');
      }
      throw error;
    }
  }
  async findByFiliere(filiereId: string) {
    this.logger.log(`Recherche des niveaux d'étude pour filière ID: ${filiereId}`);
    const niveaux = await this.niveauEtudeRepository.find({
      where: { filiere: { id: parseInt(filiereId) } },
    });
    this.logger.log(`${niveaux.length} niveau(x) d'étude trouvé(s) pour filière ${filiereId}`);
    return niveaux;
  }
  async findGroupByName(pays: string, paginationDto: PaginationDto): Promise<PaginationResponse<any>> {
    const { page = 1, limit = 10, search } = paginationDto;
    this.logger.log(`Récupération des niveaux groupés par nom (pays=${pays}, Page: ${page}, Limit: ${limit}, Search: ${search})`);

    // 1. Compter le total des noms distincts
    const countQuery = this.niveauEtudeRepository.createQueryBuilder('niveau')
      .select('COUNT(DISTINCT(niveau.nom))', 'count')
      .where('niveau.pays = :pays', { pays });

    if (search) {
      countQuery.andWhere('unaccent(niveau.nom) ILIKE unaccent(:search)', { search: `%${search}%` });
    }

    const countResult = await countQuery.getRawOne();
    const total = parseInt(countResult.count, 10);

    // 2. Récupérer les noms de la page courante
    const namesQuery = this.niveauEtudeRepository.createQueryBuilder('niveau')
      .select('DISTINCT(niveau.nom)', 'nom')
      .where('niveau.pays = :pays', { pays })
      .orderBy('nom', 'ASC') // Sorting by alias 'nom'
      .limit(limit)
      .offset((page - 1) * limit);

    if (search) {
      namesQuery.andWhere('unaccent(niveau.nom) ILIKE unaccent(:search)', { search: `%${search}%` });
    }

    const rawNames = await namesQuery.getRawMany();
    const names = rawNames.map(r => r.nom);

    if (names.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0
      };
    }

    // 3. Récupérer les données complètes pour ces noms

    const details = await this.niveauEtudeRepository.createQueryBuilder('niveau')
      .leftJoinAndSelect('niveau.filiere', 'filiere')
      .leftJoinAndSelect('filiere.etablissement', 'etablissement')
      .where('niveau.pays = :pays', { pays })
      .andWhere("niveau.nom IN (:...names)", { names })
      .orderBy('niveau.nom', 'ASC')
      .getMany();


    const grouped = new Map<string, any[]>();

    // Initialize groups for all fetched names to ensure empty ones (unlikely) or order preservation
    names.forEach(name => grouped.set(name, []));

    details.forEach(niveau => {
      const existing = grouped.get(niveau.nom);
      if (existing) {
        existing.push({
          ...niveau.filiere,
          niveau_id: niveau.id,
          duree_mois: niveau.duree_mois
        });
      }
    });

    const data = Array.from(grouped.entries()).map(([nom, filieres]) => ({
      nom,
      filieres
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
  async removeGroup(pays: string, nom: string) {
    this.logger.log(`Suppression du groupe de niveaux (pays=${pays}): ${nom}`);
    const niveaux = await this.niveauEtudeRepository.find({ where: { nom, pays } });
    if (niveaux.length === 0) {
      throw new NotFoundException('Groupe introuvable');
    }

    try {
      await this.niveauEtudeRepository.delete({ nom, pays });
      this.logger.log(`Groupe de niveaux ${nom} supprimé`);
      return { message: `Groupe ${nom} supprimé avec succès` };
    } catch (error) {
      if (error.code === '23503') {
        throw new ConflictException('Impossible de supprimer certains niveaux de ce groupe car des matières y sont associées. Veuillez d\'abord supprimer les matières.');
      }
      throw error;
    }
  }
}