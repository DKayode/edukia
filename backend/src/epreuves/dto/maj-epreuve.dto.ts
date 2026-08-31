import { IsString, IsNumber, IsOptional, IsDate, IsEnum, IsInt, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { EpreuveType, EpreuveSection, WRITABLE_EPREUVE_TYPES } from '../entities/epreuve.entity';

export class MajEpreuveDto {
  @IsOptional()
  @IsString()
  titre?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsNumber()
  duree_minutes?: number;

  @IsOptional()
  @IsNumber()
  matiere_id?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date_publication?: Date;

  @IsOptional()
  @IsNumber()
  nombre_pages?: number;

  @IsOptional()
  @IsIn(WRITABLE_EPREUVE_TYPES as unknown as string[], { message: "Le type doit être « Examens »" })
  type?: EpreuveType;

  @IsOptional()
  @IsInt()
  annee?: number;

  @IsOptional()
  @IsEnum(EpreuveSection, { message: 'La section doit être une valeur valide' })
  section?: EpreuveSection;
}