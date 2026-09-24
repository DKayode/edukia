import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Repository, Like as TypeOrmLike, FindOptionsWhere, ILike, In, Raw } from 'typeorm';
import { CreateParcourDto } from './dto/create-parcour.dto';
import { UpdateParcourDto } from './dto/update-parcour.dto';
import { Parcour } from './entities/parcour.entity';
import { ParcourQueryDto } from './dto/parcour-query.dto';

import { Commentaire } from '../commentaires/entities/commentaire.entity';
import { Like } from '../likes/entities/like.entity';
import { Favori } from 'src/favoris/entities/favoris.entity';
import { DataSourceResolver } from '../config/data-source-resolver.service';

@Injectable()
export class ParcoursService {
  constructor(
    private readonly resolver: DataSourceResolver,
  ) { }

  private get parcoursRepository(): Repository<Parcour> { return this.resolver.getRepository(Parcour); }
  private get commentaireRepository(): Repository<Commentaire> { return this.resolver.getRepository(Commentaire); }
  private get likeRepository(): Repository<Like> { return this.resolver.getRepository(Like); }
  private get favoriRepository(): Repository<Favori> { return this.resolver.getRepository(Favori); }

  // Expose each nested comment's author as a minimal `utilisateur` sub-object
  // ({ id, uuid, profil }) and keep the flat `profil` (public R2 path) for
  // backward-compat. The full utilisateur relation is dropped so no sensitive
  // user fields (e.g. password) leak into the parcours payload.
  private withCommentProfils(parcours: any): any[] {
    return (parcours.commentaires || []).map((cm: any) => {
      const { utilisateur, ...rest } = cm;
      const profil = utilisateur?.profil_photo_path || null;
      return {
        ...rest,
        profil,
        utilisateur: utilisateur
          ? { id: utilisateur.id, uuid: utilisateur.uuid, profil }
          : null,
      };
    });
  }

  /**
   * Crée un nouveau parcours
   * @param createParcoursDto - Données pour créer le parcours
   * @returns Le parcours créé
   */
  async create(createParcoursDto: CreateParcourDto): Promise<Parcour> {
    const { category_id, ...rest } = createParcoursDto;
    const parcours = this.parcoursRepository.create({
      ...rest,
      category: category_id ? { id: category_id } as any : null,
    });
    return await this.parcoursRepository.save(parcours);
  }

  /**
   * Récupère tous les parcours avec pagination et filtres
   * @param query - Paramètres de requête (pagination, filtres)
   * @returns Liste paginée des parcours avec métadonnées
   */
  async findAll(pays: string, query: ParcourQueryDto): Promise<{
    data: Parcour[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { page, limit, ...filters } = query;
    const skip = (page - 1) * limit;

    // Construction de la clause WHERE.
    //
    // Le pays cadre TOUT : une seule base porte les parcours de tous les
    // pays (colonne `pays`), et sans ce filtre un compte sénégalais recevait
    // les parcours béninois. Inoffensif tant que tout est au Bénin, faux dès
    // qu'un second pays publie.
    const where: FindOptionsWhere<Parcour> = { pays };

    if (filters.titre) {
      where.titre = Raw((alias) => `unaccent(${alias}) ILIKE unaccent(:titre)`, { titre: `%${filters.titre}%` });
    }

    // CORRECTION ICI : Filtre par category_id
    if (filters.category_id) {
      // Si category_id est un nombre
      if (typeof filters.category_id === 'number') {
        where.category = { id: filters.category_id } as any;
      }
      // Si c'est un tableau d'IDs
      else if (Array.isArray(filters.category_id)) {
        where.category = { id: In(filters.category_id) } as any;
      }
    }

    if (filters.type_media) {
      where.type_media = filters.type_media;
    }

    // Recherche globale sur plusieurs champs
    if (filters.search) {
      where.titre = Raw((alias) => `unaccent(${alias}) ILIKE unaccent(:search)`, { search: `%${filters.search}%` });
      // Pour rechercher sur plusieurs champs :
      // where = [
      //   { titre: Raw(alias => `unaccent(${alias}) ILIKE unaccent('%${filters.search}%')`) },
      //   { description: Raw(alias => `unaccent(${alias}) ILIKE unaccent('%${filters.search}%')`) }
      // ] as FindOptionsWhere<Parcour>[];
    }

    // Exécution de la requête
    const [data, total] = await this.parcoursRepository.findAndCount({
      where,
      order: { [filters.sortBy]: filters.order },
      skip,
      take: limit,
      relations: ['commentaires', 'commentaires.utilisateur', 'likes', 'favoris', 'category'],
    });

    // Ajout des compteurs
    const parcoursWithCounts = data.map(parcours => ({
      ...parcours,
      commentaires: this.withCommentProfils(parcours),
      commentairesCount: parcours.commentaires?.length || 0,
      likesCount: parcours.likes?.filter(like => like.type == "like").length || 0,
      favorisCount: parcours.favoris?.length || 0,
    }));

    return {
      data: parcoursWithCounts,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Récupère un parcours par son ID
   * @param id - ID du parcours
   * @returns Le parcours trouvé
   * @throws NotFoundException si le parcours n'existe pas
   */
  async findOne(id: number): Promise<Parcour> {
    const parcours = await this.parcoursRepository.findOne({
      where: { id },
      relations: ['commentaires', 'commentaires.utilisateur', 'likes', 'favoris', 'category'],
    });

    if (!parcours) {
      throw new NotFoundException(`Parcours avec l'ID ${id} non trouvé`);
    }

    // Ajout des compteurs
    return {
      ...parcours,
      commentaires: this.withCommentProfils(parcours),
      commentairesCount: parcours.commentaires?.length || 0,
      likesCount: parcours.likes?.filter(like => like.type == "like").length || 0,
      favorisCount: parcours.favoris?.length || 0,
    };
  }

  /**
   * Met à jour un parcours existant
   * @param id - ID du parcours à mettre à jour
   * @param updateParcoursDto - Données de mise à jour
   * @returns Le parcours mis à jour
   * @throws NotFoundException si le parcours n'existe pas
   */
  async update(id: number, updateParcoursDto: UpdateParcourDto): Promise<Parcour> {
    const parcours = await this.findOne(id);
    const { category_id, ...rest } = updateParcoursDto;

    Object.assign(parcours, rest);

    if (category_id) {
      parcours.category = { id: category_id } as any;
    }

    return await this.parcoursRepository.save(parcours);
  }

  async remove(id: number): Promise<void> {
    // Vérifier si le parcours existe
    const parcours = await this.parcoursRepository.findOne({
      where: { id },
    });

    if (!parcours) {
      throw new NotFoundException(`Parcours avec l'ID ${id} non trouvé`);
    }

    // Supprimer dans l'ordre inverse des dépendances

    // 1. Supprimer les likes associés aux commentaires du parcours
    const comments = await this.commentaireRepository.find({
      where: { parcours_id: id },
      select: ['id']
    });

    if (comments.length > 0) {
      const commentIds = comments.map(c => c.id);
      await this.likeRepository.delete({ commentaire_id: In(commentIds) });
    }

    // 2. Supprimer les commentaires et autres dépendances directes
    await this.commentaireRepository.delete({ parcours_id: id });
    await this.likeRepository.delete({ parcours_id: id });
    await this.favoriRepository.delete({ parcours_id: id });

    // Supprimer le parcours
    const result = await this.parcoursRepository.delete(id);

    if (result.affected === 0) {
      throw new NotFoundException(`Parcours avec l'ID ${id} non trouvé`);
    }
  }


  /**
   * Recherche des parcours par terme de recherche
   * @param search - Terme de recherche
   * @param limit - Nombre maximum de résultats
   * @returns Liste des parcours correspondants
   */
  async search(pays: string, search: string, limit: number = 10): Promise<Parcour[]> {
    // `pays` répété dans chaque branche : un OR sans lui laisserait remonter
    // les parcours des autres pays dès qu'un titre correspond.
    const motif = `%${search}%`;
    return await this.parcoursRepository.find({
      where: [
        { pays, titre: Raw((alias) => `unaccent(${alias}) ILIKE unaccent(:motif)`, { motif }) },
        { pays, description: Raw((alias) => `unaccent(${alias}) ILIKE unaccent(:motif)`, { motif }) },
      ],
      take: limit,
    });
  }
  async findOneForDownloadImage(id: number): Promise<{ url: string; titre: string }> {
    const parcours = await this.findOne(id);
    if (!parcours.image_couverture) {
      throw new NotFoundException('Parcours n\'a pas d\'image de couverture');
    }
    return { url: parcours.image_couverture, titre: parcours.titre };
  }

  async findOneForDownloadMedia(id: number): Promise<{ url: string; titre: string }> {
    const parcours = await this.findOne(id);
    if (!parcours) {
      throw new NotFoundException('Parcours introuvable');
    }
    if (parcours.type_media !== 'image') {
      throw new BadRequestException('Ce parcours n\'est pas de type Image');
    }
    if (!parcours.lien_video) { // In Image mode, lien_video holds the image URL
      throw new NotFoundException('Ce parcours n\'a pas de contenu image associé');
    }
    return { url: parcours.lien_video, titre: parcours.titre };
  }

  async findOneForLink(id: number): Promise<{ link: string }> {
    const parcours = await this.findOne(id);
    if (!parcours) {
      throw new NotFoundException('Parcours introuvable');
    }
    if (parcours.type_media !== 'video') {
      throw new BadRequestException('Ce parcours n\'est pas de type Vidéo');
    }
    if (!parcours.lien_video) {
      throw new NotFoundException('Ce parcours n\'a pas de lien vidéo associé');
    }
    return { link: parcours.lien_video };
  }

  async findOneForCategoryIcon(id: number): Promise<{ url: string }> {
    const parcours = await this.parcoursRepository.findOne({
      where: { id },
      relations: ['category']
    });

    if (!parcours) {
      throw new NotFoundException(`Parcours avec l'ID ${id} non trouvé`);
    }

    if (!parcours.category) {
      throw new NotFoundException(`Le parcours ${id} n'a pas de catégorie associée`);
    }

    if (!parcours.category.icone) {
      throw new NotFoundException(`La catégorie associée au parcours ${id} n'a pas d'icône`);
    }

    return { url: parcours.category.icone };
  }
}