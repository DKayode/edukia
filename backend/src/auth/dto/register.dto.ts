import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsEmail, MinLength, IsEnum, IsOptional, IsIn, IsBoolean, ValidateNested } from 'class-validator';
import { RoleType, SexeType, AgeGroup } from '../../utilisateurs/entities/utilisateur.entity';
import { DeviceAttestationDto } from '../../device-credits/dto/device-attestation.dto';

export class RegisterDto {
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

    @ApiProperty({ example: 'password123', description: 'Le mot de passe de l\'utilisateur (min 6 caractères)' })
    @IsString()
    @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
    mot_de_passe: string;

    @ApiProperty({ enum: RoleType, example: RoleType.ETUDIANT, description: 'Le rôle de l\'utilisateur' })
    @IsEnum(RoleType)
    role: RoleType;

    @ApiProperty({ enum: SexeType, example: SexeType.M, description: 'Le sexe de l\'utilisateur' })
    @IsEnum(SexeType)
    sexe: SexeType;

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
