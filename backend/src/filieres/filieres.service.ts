import { Injectable, NotFoundException, Logger, ConflictException } from '@nestjs/common';
import { Repository, Like, FindOptionsWhere, Brackets } from 'typeorm';
import { Filiere } from './entities/filiere.entity';
import { Etablissement } from '../etablissements/entities/etablissement.entity';
import { CreerFiliereDto } from './dto/creer-filiere.dto';
import { MajFiliereDto } from './dto/maj-filiere.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginationResponse } from '../common/interfaces/pagination-response.interface';
import { FilterFiliereDto } from './dto/filter-filiere.dto';
import { FiliereResponseDto } from './dto/filiere-response.dto';
import { DataSourceResolver } from '../config/data-source-resolver.service';
import { memeLibelle, normaliserLibelle } from '../common/utils/libelles';

@Injectable()
export class FilieresService {
  private readonly logger = new Logger(FilieresService.name);

  constructor(
    private readonly resolver: DataSourceResolver,
  ) { }

  private get filieresRepository(): Repository<Filiere> {
    return this.resolver.getRepository(Filiere);
  }

  private get etablissementsRepository(): Repository<Etablissement> {
    return this.resolver.getRepository(Etablissement);
  }

  async create(creerFiliereDto: CreerFiliereDto) {
    this.logger.log(`Création d'une filière: ${creerFiliereDto.nom} (Établissement ID: ${creerFiliereDto.etablissement_id})`);
    // pays is DERIVED from the parent Etablissement (single source of truth),
    // never from the request country switcher nor the column default.
    const etablissement = await this.etablissementsRepository.findOne({
      where: { id: creerFiliereDto.etablissement_id },
    });
    if (!etablissement) {
      this.logger.warn(`Établissement ID ${creerFiliereDto.etablissement_id} introuvable`);
      throw new NotFoundException('Établissement non trouvé');
    }
    const nom = normaliserLibelle(creerFiliereDto.nom);

    // Un établissement ne doit pas porter deux fois la même filière — 8 lignes
    // en double existent aujourd'hui. On rend l'existante plutôt que d'en
    // ajouter une : la création devient idempotente.
    const existante = await this.trouverEquivalente(creerFiliereDto.etablissement_id, nom);
    if (existante) {
      this.logger.log(
        `Filière « ${nom} » déjà présente sur l'établissement ${creerFiliereDto.etablissement_id} ` +
          `(ID ${existante.id}) : réutilisée plutôt que dupliquée.`,
      );
      return existante;
    }

    const newFiliere = this.filieresRepository.create({
      nom,
      etablissement: { id: creerFiliereDto.etablissement_id } as any,
      pays: etablissement.pays,
    });
    const saved = await this.filieresRepository.save(newFiliere);
    this.logger.log(`Filière créée: ${saved.nom} (ID: ${saved.id}, pays: ${saved.pays})`);
    return saved;
  }

  /** La filière déjà présente sous cet établissement et désignant la même chose. */
  private async trouverEquivalente(etablissementId: number, nom: string) {
    const existantes = await this.filieresRepository.find({
      where: { etablissement_id: etablissementId } as any,
    });
    return existantes.find((f) => memeLibelle(f.nom, nom)) ?? null;
  }

  async findAll(pays: string, filterDto: FilterFiliereDto): Promise<PaginationResponse<FiliereResponseDto>> {
    const { page = 1, limit = 10, search, etablissement } = filterDto;
    this.logger.log(`Récupération des filières (pays=${pays}) - Page: ${page}, Limite: ${limit}, Search: ${search}, Etablissement: ${etablissement}`);

    const queryBuilder = this.filieresRepository.createQueryBuilder('filiere')
      .leftJoinAndSelect('filiere.etablissement', 'etablissement')
      .where('filiere.pays = :pays', { pays })
      .orderBy('filiere.nom', filterDto.sort_order || 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (etablissement) {
      queryBuilder.andWhere('etablissement.nom = :etablissement', { etablissement });
    }

    if (search) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where('unaccent(filiere.nom) ILIKE unaccent(:search)', { search: `%${search}%` })
            .orWhere('unaccent(etablissement.nom) ILIKE unaccent(:search)', { search: `%${search}%` })
            .orWhere('unaccent(etablissement.ville) ILIKE unaccent(:search)', { search: `%${search}%` });
        }),
      );
    }

    const [filieres, total] = await queryBuilder.getManyAndCount();

    this.logger.log(`${filieres.length} filière(s) trouvée(s) sur ${total} total`);

    const data = filieres.map(filiere => ({
      id: filiere.id,
      nom: filiere.nom,
      etablissement: filiere.etablissement,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<FiliereResponseDto> {
    this.logger.log(`Recherche de la filière ID: ${id}`);
    const filiere = await this.filieresRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['etablissement'],
    });

    if (!filiere) {
      this.logger.warn(`Filière ID ${id} introuvable`);
      throw new NotFoundException('Filière non trouvée');
    }

    this.logger.log(`Filière trouvée: ${filiere.nom} (ID: ${id})`);

    return {
      id: filiere.id,
      nom: filiere.nom,
      etablissement: filiere.etablissement,
    };
  }

  async update(id: string, majFiliereDto: MajFiliereDto) {
    this.logger.log(`Mise à jour de la filière ID: ${id}`);
    const filiere = await this.filieresRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!filiere) {
      this.logger.warn(`Mise à jour échouée: filière ID ${id} introuvable`);
      throw new NotFoundException('Filière non trouvée');
    }

    if (majFiliereDto.nom) {
      filiere.nom = majFiliereDto.nom;
    }

    if (majFiliereDto.etablissement_id) {
      // Parent changed → re-derive pays from the new Etablissement.
      const etablissement = await this.etablissementsRepository.findOne({
        where: { id: majFiliereDto.etablissement_id },
      });
      if (!etablissement) {
        this.logger.warn(`Établissement ID ${majFiliereDto.etablissement_id} introuvable`);
        throw new NotFoundException('Établissement non trouvé');
      }
      filiere.etablissement = { id: majFiliereDto.etablissement_id } as any;
      filiere.pays = etablissement.pays;
    }

    const updated = await this.filieresRepository.save(filiere);
    this.logger.log(`Filière mise à jour: ${updated.nom} (ID: ${id})`);
    return updated;
  }

  async remove(id: string) {
    this.logger.log(`Suppression de la filière ID: ${id}`);
    const filiere = await this.filieresRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!filiere) {
      this.logger.warn(`Suppression échouée: filière ID ${id} introuvable`);
      throw new NotFoundException('Filière non trouvée');
    }

    try {
      await this.filieresRepository.remove(filiere);
      this.logger.log(`Filière supprimée: ${filiere.nom} (ID: ${id})`);
      return { message: 'Filière supprimée avec succès' };
    } catch (error) {
      if (error.code === '23503') {
        throw new ConflictException('Impossible de supprimer cette filière car des niveaux d\'étude y sont associés. Veuillez d\'abord supprimer les niveaux d\'étude.');
      }
      throw error;
    }
  }

  async findByEtablissement(etablissementId: string) {
    this.logger.log(`Recherche des filières pour établissement ID: ${etablissementId}`);
    const filieres = await this.filieresRepository.find({
      where: { etablissement: { id: parseInt(etablissementId) } },
    });
    this.logger.log(`${filieres.length} filière(s) trouvée(s) pour établissement ${etablissementId}`);
    return filieres;
  }
}