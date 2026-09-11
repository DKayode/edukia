import {
  DeviceAttestationDto,
  DeviceAttestationProvider,
} from './dto/device-attestation.dto';

export type DeviceCreditControlMode = 'off' | 'monitor' | 'enforce';

export interface RegistrationBinding {
  email: string;
  pays: string;
}

export interface VerifiedDeviceProof {
  provider: DeviceAttestationProvider;
  platform: 'android' | 'ios';
  installationId: string;
  token: string;
  vendorCount: number;
}

export interface PreparedDeviceCreditDecision {
  mode: DeviceCreditControlMode;
  proof?: VerifiedDeviceProof;
  proofStatus: 'SKIPPED' | 'VERIFIED' | 'MISSING' | 'INVALID';
  reason: string;
  attestation?: DeviceAttestationDto;
}

export interface DeviceCreditAllocation {
  eligible: boolean;
  countAfter?: number;
  reason: string;
}

export interface DeviceProofVerifier {
  verify(
    attestation: DeviceAttestationDto,
    binding: RegistrationBinding,
  ): Promise<VerifiedDeviceProof>;
  writeCount(proof: VerifiedDeviceProof, count: number): Promise<void>;
}
