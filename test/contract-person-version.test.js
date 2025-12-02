const { expect } = require('chai');
const hre = require('hardhat');
const { buildBasicInfo } = require('../lib/namePoseidon');
const { generatePersonHashProof } = require('../lib/personHashProof');

// Tests focused on add-person (version creation) including validation and duplicate logic

describe('Person Version (add-person) Tests', function () {
  this.timeout(120_000);

  async function baseSetup() {
    await hre.deployments.fixture(['Integrated']);
    const deepDeployment = await hre.deployments.get('DeepFamily');
    const deepFamily = await hre.ethers.getContractAt('DeepFamily', deepDeployment.address);
    return { deepFamily };
  }

  it('adds a basic person and emits event', async () => {
    const { deepFamily } = await baseSetup();
    await hre.run('add-person', {
      fullname: 'John Doe',
      birthyear: '1990',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmCID1'
    });
    const basicInfo = buildBasicInfo({
      fullName: 'John Doe',
      birthYear: 1990,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const personHash = await deepFamily.getPersonHash(basicInfo);
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0);
    expect(totalVersions).to.equal(1n);
  });

  it('reverts on empty full name', async () => {
    await baseSetup();
    await expect(
      hre.run('add-person', { fullname: '', birthyear: '1990', gender: '1', tag: 'v1', ipfs: 'QmCID1' })
    ).to.be.rejectedWith(/InvalidFullName/); // custom error bubbles as HardhatError message
  });

  it('reverts on invalid birthMonth / birthDay via direct call (solidity validation)', async () => {
    const { deepFamily } = await baseSetup();
    // Construct invalid basic info to call pure getPersonHash (will revert)
    const baseInfo = {
      fullName: 'A',
      birthYear: 1000,
      gender: 1,
    };
    await expect(
      deepFamily.getPersonHash(
        buildBasicInfo({ ...baseInfo, birthMonth: 13, birthDay: 0 })
      )
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidBirthMonth');
    await expect(
      deepFamily.getPersonHash(
        buildBasicInfo({ ...baseInfo, birthMonth: 12, birthDay: 32 })
      )
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidBirthDay');
  });

  it('prevents duplicate version (same inputs)', async () => {
    const { deepFamily } = await baseSetup();
    const params = { fullname: 'Dup Person', birthyear: '2000', gender: '1', tag: 'v1', ipfs: 'QmCIDx' };
    await hre.run('add-person', params);
    await expect(hre.run('add-person', params)).to.be.rejectedWith(/DuplicateVersion/);
  });

  it('adds person without parents (zero hash preserved)', async () => {
    const { deepFamily } = await baseSetup();

    // Add person without parents
    await hre.run('add-person', {
      fullname: 'Orphan Person',
      birthyear: '2000',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmOrphan'
    });

    const basicInfo = buildBasicInfo({
      fullName: 'Orphan Person',
      birthYear: 2000,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const personHash = await deepFamily.getPersonHash(basicInfo);

    // Verify person was added
    const [versions, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100);
    expect(totalVersions).to.equal(1n);

    // Verify parent hashes are zero (not wrapped)
    expect(versions[0].fatherHash).to.equal(hre.ethers.ZeroHash);
    expect(versions[0].motherHash).to.equal(hre.ethers.ZeroHash);

    // Verify no children are added to the keccak256(0x00...00) hash
    const fakeParentHash = hre.ethers.keccak256(hre.ethers.solidityPacked(['bytes32'], [hre.ethers.ZeroHash]));
    const [fakeChildren] = await deepFamily.listChildren(fakeParentHash, 0, 0, 100);
    expect(fakeChildren.length).to.equal(0);
  });

  it('adds person with complete parent information', async () => {
    const { deepFamily } = await baseSetup();

    // Add father
    await hre.run('add-person', {
      fullname: 'Father Name',
      birthyear: '1960',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmFather'
    });

    // Add mother
    await hre.run('add-person', {
      fullname: 'Mother Name',
      birthyear: '1965',
      gender: '2',
      tag: 'v1',
      ipfs: 'QmMother'
    });

    // Add child with parent info
    await hre.run('add-person', {
      fullname: 'Child Name',
      birthyear: '1990',
      gender: '1',
      fathername: 'Father Name',
      fatherbirthyear: '1960',
      fathergender: '1',
      mothername: 'Mother Name',
      motherbirthyear: '1965',
      mothergender: '2',
      fatherversion: '0',
      motherversion: '0',
      tag: 'v1',
      ipfs: 'QmChild'
    });

    const childInfo = buildBasicInfo({
      fullName: 'Child Name',
      birthYear: 1990,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const childHash = await deepFamily.getPersonHash(childInfo);

    const [versions, totalVersions] = await deepFamily.listPersonVersions(childHash, 0, 100);
    expect(totalVersions).to.equal(1n);

    // Verify parent hashes are not zero
    expect(versions[0].fatherHash).to.not.equal(hre.ethers.ZeroHash);
    expect(versions[0].motherHash).to.not.equal(hre.ethers.ZeroHash);
  });

  it('adds multiple versions for same person', async () => {
    const { deepFamily } = await baseSetup();

    await hre.run('add-person', {
      fullname: 'Multi Version',
      birthyear: '1980',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmV1'
    });

    await hre.run('add-person', {
      fullname: 'Multi Version',
      birthyear: '1980',
      gender: '1',
      tag: 'v2',
      ipfs: 'QmV2'
    });

    const basicInfo = buildBasicInfo({
      fullName: 'Multi Version',
      birthYear: 1980,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const personHash = await deepFamily.getPersonHash(basicInfo);

    const [versions, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100);
    expect(totalVersions).to.equal(2n);
    expect(versions[0].tagHash).to.equal(hre.ethers.keccak256(hre.ethers.toUtf8Bytes('v1')));
    expect(versions[1].tagHash).to.equal(hre.ethers.keccak256(hre.ethers.toUtf8Bytes('v2')));
  });

  describe('updatePersonParents', () => {
    it('allows original submitter to backfill parents sequentially', async () => {
      const { deepFamily } = await baseSetup();
      const [deployer] = await hre.ethers.getSigners();
      const deployerAddress = await deployer.getAddress();

      await hre.run('add-person', {
        fullname: 'Backfill Father',
        birthyear: '1960',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmFather'
      });

      await hre.run('add-person', {
        fullname: 'Backfill Mother',
        birthyear: '1965',
        gender: '2',
        tag: 'v1',
        ipfs: 'QmMother'
      });

      await hre.run('add-person', {
        fullname: 'Backfill Child',
        birthyear: '1990',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmChildNoParents'
      });

      const fatherHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Backfill Father',
          birthYear: 1960,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );
      const motherHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Backfill Mother',
          birthYear: 1965,
          birthMonth: 0,
          birthDay: 0,
          gender: 2,
        })
      );
      const childHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Backfill Child',
          birthYear: 1990,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );

      await expect(
        deepFamily
          .connect(deployer)
          .updatePersonParents(
            childHash,
            1,
            fatherHash,
            1,
            hre.ethers.ZeroHash,
            0
          )
      )
        .to.emit(deepFamily, 'PersonParentsUpdated')
        .withArgs(childHash, 1n, fatherHash, 1n, hre.ethers.ZeroHash, 0n, deployerAddress);

      let [childVersions] = await deepFamily.listPersonVersions(childHash, 0, 10);
      expect(childVersions[0].fatherHash).to.equal(fatherHash);
      expect(childVersions[0].fatherVersionIndex).to.equal(1n);
      expect(childVersions[0].motherHash).to.equal(hre.ethers.ZeroHash);

      let fatherChildren = await deepFamily.listChildren(fatherHash, 1, 0, 10);
      expect(fatherChildren[0].length).to.equal(1);
      expect(fatherChildren[0][0]).to.equal(childHash);
      expect(fatherChildren[1][0]).to.equal(1n);

      await expect(
        deepFamily
          .connect(deployer)
          .updatePersonParents(
            childHash,
            1,
            hre.ethers.ZeroHash,
            0,
            motherHash,
            1
          )
      )
        .to.emit(deepFamily, 'PersonParentsUpdated')
        .withArgs(childHash, 1n, fatherHash, 1n, motherHash, 1n, deployerAddress);

      [childVersions] = await deepFamily.listPersonVersions(childHash, 0, 10);
      expect(childVersions[0].motherHash).to.equal(motherHash);
      expect(childVersions[0].motherVersionIndex).to.equal(1n);

      const motherChildren = await deepFamily.listChildren(motherHash, 1, 0, 10);
      expect(motherChildren[0].length).to.equal(1);
      expect(motherChildren[0][0]).to.equal(childHash);
      expect(motherChildren[1][0]).to.equal(1n);
    });

    it('rejects parent updates from non submitter/non owner', async () => {
      const { deepFamily } = await baseSetup();
      const [, attacker] = await hre.ethers.getSigners();

      await hre.run('add-person', {
        fullname: 'Guarded Father',
        birthyear: '1955',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmGFather'
      });

      await hre.run('add-person', {
        fullname: 'Guarded Child',
        birthyear: '1995',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmGChild'
      });

      const fatherHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Guarded Father',
          birthYear: 1955,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );
      const childHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Guarded Child',
          birthYear: 1995,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );

      await expect(
        deepFamily
          .connect(attacker)
          .updatePersonParents(
            childHash,
            1,
            fatherHash,
            1,
            hre.ethers.ZeroHash,
            0
          )
      ).to.be.revertedWithCustomError(deepFamily, 'UnauthorizedParentUpdate');
    });

    it('prevents reassigning a parent once set', async () => {
      const { deepFamily } = await baseSetup();
      const [deployer] = await hre.ethers.getSigners();

      await hre.run('add-person', {
        fullname: 'First Father',
        birthyear: '1940',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmFirstFather'
      });

      await hre.run('add-person', {
        fullname: 'Parented Child',
        birthyear: '1970',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmParented'
      });

      const fatherHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'First Father',
          birthYear: 1940,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );
      const childHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Parented Child',
          birthYear: 1970,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );

      await deepFamily
        .connect(deployer)
        .updatePersonParents(
          childHash,
          1,
          fatherHash,
          1,
          hre.ethers.ZeroHash,
          0
        );

      await expect(
        deepFamily
          .connect(deployer)
          .updatePersonParents(
            childHash,
            1,
            fatherHash,
            1,
            hre.ethers.ZeroHash,
            0
          )
      ).to.be.revertedWithCustomError(deepFamily, 'FatherAlreadySet');
    });

    it('allows linking parent with unspecified (zero) version index', async () => {
      const { deepFamily } = await baseSetup();
      const [deployer] = await hre.ethers.getSigners();
      const deployerAddress = await deployer.getAddress();

      await hre.run('add-person', {
        fullname: 'Zero Index Father',
        birthyear: '1945',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmZeroFather'
      });

      await hre.run('add-person', {
        fullname: 'Zero Index Child',
        birthyear: '1975',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmZeroChild'
      });

      const fatherHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Zero Index Father',
          birthYear: 1945,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );
      const childHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Zero Index Child',
          birthYear: 1975,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );

      await expect(
        deepFamily
          .connect(deployer)
          .updatePersonParents(
            childHash,
            1,
            fatherHash,
            0,
            hre.ethers.ZeroHash,
            0
          )
      )
        .to.emit(deepFamily, 'PersonParentsUpdated')
        .withArgs(childHash, 1n, fatherHash, 0n, hre.ethers.ZeroHash, 0n, deployerAddress);

      const [childVersions] = await deepFamily.listPersonVersions(childHash, 0, 10);
      expect(childVersions[0].fatherHash).to.equal(fatherHash);
      expect(childVersions[0].fatherVersionIndex).to.equal(0n);

      const zeroVersionChildren = await deepFamily.listChildren(fatherHash, 0, 0, 10);
      expect(zeroVersionChildren[0].length).to.equal(1);
      expect(zeroVersionChildren[0][0]).to.equal(childHash);
      expect(zeroVersionChildren[1][0]).to.equal(1n);
    });

    it('rejects setting a parent hash equal to the child hash', async () => {
      const { deepFamily } = await baseSetup();
      const [deployer] = await hre.ethers.getSigners();

      await hre.run('add-person', {
        fullname: 'Self Parent',
        birthyear: '1990',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmSelf'
      });

      const childHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Self Parent',
          birthYear: 1990,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );

      await expect(
        deepFamily
          .connect(deployer)
          .updatePersonParents(
            childHash,
            1,
            childHash,
            1,
            hre.ethers.ZeroHash,
            0
          )
      ).to.be.revertedWithCustomError(deepFamily, 'InvalidParentHash');
    });

    it('rejects assigning the same hash to both parents in a single update', async () => {
      const { deepFamily } = await baseSetup();
      const [deployer] = await hre.ethers.getSigners();

      await hre.run('add-person', {
        fullname: 'Dual Parent',
        birthyear: '1970',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmDualParent'
      });

      await hre.run('add-person', {
        fullname: 'Dual Parent Child',
        birthyear: '2000',
        gender: '1',
        tag: 'v1',
        ipfs: 'QmDualChild'
      });

      const parentHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Dual Parent',
          birthYear: 1970,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );

      const childHash = await deepFamily.getPersonHash(
        buildBasicInfo({
          fullName: 'Dual Parent Child',
          birthYear: 2000,
          birthMonth: 0,
          birthDay: 0,
          gender: 1,
        })
      );

      await expect(
        deepFamily
          .connect(deployer)
          .updatePersonParents(
            childHash,
            1,
            parentHash,
            1,
            parentHash,
            1
          )
      ).to.be.revertedWithCustomError(deepFamily, 'InvalidParentHash');
    });
  });

  it('reverts when proof submitter does not match caller', async () => {
    const { deepFamily } = await baseSetup();
    const [submitter, mismatchedCaller] = await hre.ethers.getSigners();
    const submitterAddr = await submitter.getAddress();

    const personData = {
      fullName: 'Caller Bound',
      passphrase: '',
      isBirthBC: false,
      birthYear: 1985,
      birthMonth: 5,
      birthDay: 20,
      gender: 1,
    };

    const { proof, publicSignals } = await generatePersonHashProof(
      personData,
      null,
      null,
      submitterAddr,
    );

    await expect(
      deepFamily
        .connect(mismatchedCaller)
        .addPersonZK(
          proof.a,
          proof.b,
          proof.c,
          publicSignals,
          0,
          0,
          hre.ethers.keccak256(hre.ethers.toUtf8Bytes('vCaller')),
          'ipfs://caller-mismatch',
        ),
    ).to.be.revertedWithCustomError(deepFamily, 'CallerMismatch');
  });

  it('handles person with passphrase', async () => {
    const { deepFamily } = await baseSetup();

    await hre.run('add-person', {
      fullname: 'Secret Person',
      passphrase: 'my-secret-passphrase',
      birthyear: '1995',
      gender: '2',
      tag: 'v1',
      ipfs: 'QmSecret'
    });

    // Different passphrase results in different person hash
    const basicInfoWithPassphrase = buildBasicInfo({
      fullName: 'Secret Person',
      passphrase: 'my-secret-passphrase',
      birthYear: 1995,
      birthMonth: 0,
      birthDay: 0,
      gender: 2,
    });

    const basicInfoWithoutPassphrase = buildBasicInfo({
      fullName: 'Secret Person',
      birthYear: 1995,
      birthMonth: 0,
      birthDay: 0,
      gender: 2,
    });

    const hashWithPassphrase = await deepFamily.getPersonHash(basicInfoWithPassphrase);
    const hashWithoutPassphrase = await deepFamily.getPersonHash(basicInfoWithoutPassphrase);

    expect(hashWithPassphrase).to.not.equal(hashWithoutPassphrase);

    const [, totalVersions] = await deepFamily.listPersonVersions(hashWithPassphrase, 0, 100);
    expect(totalVersions).to.equal(1n);
  });

  it('handles BC birth year correctly', async () => {
    const { deepFamily } = await baseSetup();

    await hre.run('add-person', {
      fullname: 'Ancient Person',
      birthbc: 'true',
      birthyear: '500',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmAncient'
    });

    const basicInfo = buildBasicInfo({
      fullName: 'Ancient Person',
      isBirthBC: true,
      birthYear: 500,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });

    const personHash = await deepFamily.getPersonHash(basicInfo);
    const [versions, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100);
    expect(totalVersions).to.equal(1n);
  });

  it('handles full birth date (month and day)', async () => {
    const { deepFamily } = await baseSetup();

    await hre.run('add-person', {
      fullname: 'Dated Person',
      birthyear: '2000',
      birthmonth: '6',
      birthday: '15',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmDated'
    });

    const basicInfo = buildBasicInfo({
      fullName: 'Dated Person',
      birthYear: 2000,
      birthMonth: 6,
      birthDay: 15,
      gender: 1,
    });

    const personHash = await deepFamily.getPersonHash(basicInfo);
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100);
    expect(totalVersions).to.equal(1n);
  });

  it('handles different gender values', async () => {
    const { deepFamily } = await baseSetup();

    const genders = ['0', '1', '2', '3']; // Unknown, Male, Female, Other

    for (let i = 0; i < genders.length; i++) {
      await hre.run('add-person', {
        fullname: `Person Gender ${genders[i]}`,
        birthyear: '2000',
        gender: genders[i],
        tag: 'v1',
        ipfs: `QmGender${i}`
      });

      const basicInfo = buildBasicInfo({
        fullName: `Person Gender ${genders[i]}`,
        birthYear: 2000,
        birthMonth: 0,
        birthDay: 0,
        gender: parseInt(genders[i]),
      });

      const personHash = await deepFamily.getPersonHash(basicInfo);
      const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100);
      expect(totalVersions).to.equal(1n);
    }
  });

  it('trims whitespace from fullname', async () => {
    const { deepFamily } = await baseSetup();

    await hre.run('add-person', {
      fullname: '  Trimmed Name  ',
      birthyear: '2000',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmTrim'
    });

    // Should match the trimmed version
    const basicInfo = buildBasicInfo({
      fullName: 'Trimmed Name',
      birthYear: 2000,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });

    const personHash = await deepFamily.getPersonHash(basicInfo);
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100);
    expect(totalVersions).to.equal(1n);
  });
});
