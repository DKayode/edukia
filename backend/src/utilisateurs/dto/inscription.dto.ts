import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsString, MinLength, IsOptional, IsEnum, IsNumber, IsIn, IsBoolean, ValidateNested } from 'class-validator';
import { RoleType, SexeType, AgeGroup } from '../entities/utilisateur.entity';
import { DeviceAttestationDto } from '../../device-credits/dto/device-attestation.dto';

export class InscriptionDto {
  @ApiProperty({ example: 'Doe', description: 'Le nom de l\'utilisateur' })
  @IsString()
  nom: string;

  @ApiProperty({ example: 'John', description: 'Le prénom de l\'utilisateur' })
  @IsString()
  prenom: string;

  @ApiProperty({ example: 'johndoe', description: 'Le pseudo de l\'utilisateur', required: false })
  @IsOptional()
  @IsString()
  pseudo?: string;

  @ApiProperty({ example: 'john.doe@example.com', description: 'L\'adresse email de l\'utilisateur' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'Le mot de passe de l\'utilisateur (min 8 caractères)' })
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  mot_de_passe: string;

  @ApiProperty({ description: 'URL de la photo de profil', required: false })
  @IsOptional()
  @IsString()
  photo?: string;

  @ApiProperty({ description: 'Token Firebase Cloud Messaging', required: false })
  @IsOptional()
  @IsString()
  fcm_token?: string;

  @ApiProperty({ enum: SexeType, example: SexeType.M, description: 'Le sexe de l\'utilisateur', required: false })
  @IsOptional()
  @IsEnum(SexeType)
  sexe?: SexeType;

  @ApiProperty({ example: '+33612345678', description: 'Numéro de téléphone', required: false })
  @IsOptional()
  @IsString()
  telephone?: string;

  @ApiProperty({ enum: RoleType, example: RoleType.ETUDIANT, description: 'Le rôle de l\'utilisateur' })
  @IsEnum(RoleType)
  role: RoleType;

  @ApiProperty({ example: 1, description: 'ID de l\'établissement', required: false })
  @IsOptional()
  @IsNumber()
  etablissement_id?: number;

  @ApiProperty({ example: 1, description: 'ID de la filière', required: false })
  @IsOptional()
  @IsNumber()
  filiere_id?: number;

  @ApiProperty({ example: 1, description: 'ID du niveau d\'étude', required: false })
  @IsOptional()
  @IsNumber()
  niveau_etude_id?: number;

  @ApiProperty({ example: 'CODE123', description: 'Code de parrainage', required: false })
  @IsOptional()
  @IsString()
  code_parrainage?: string;

  @ApiProperty({ enum: AgeGroup, example: '18 - 25', description: "Tranche d'âge (valeurs prédéfinies)", required: false })
  @IsOptional()
  @IsEnum(AgeGroup)
  age_group?: AgeGroup;

  @ApiProperty({ enum: ['rural', 'urbain'], description: 'Zone de résidence (PII optionnelle)', required: false })
  @IsOptional()
  @IsIn(['rural', 'urbain'])
  zone_residence?: string;

  @ApiProperty({ example: false, description: 'Situation de handicap (oui/non)', required: false })
  @IsOptional()
  @IsBoolean()
  situation_handicap?: boolean;

  @ApiProperty({ type: DeviceAttestationDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceAttestationDto)
  device_attestation?: DeviceAttestationDto;
}
