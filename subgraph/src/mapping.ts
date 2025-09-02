// SPDX-License-Identifier: MIT
import { BigInt, Bytes, store } from "@graphprotocol/graph-ts";
import { Person, PersonVersion, ParentChildEdge } from "../generated/schema";
import { PersonVersionAdded } from "../generated/DeepFamily/DeepFamily";

function makePersonId(hash: Bytes): string {
	return hash.toHexString();
}

function makeVersionId(hash: Bytes, versionIndex: BigInt): string {
	return hash.toHexString() + "-v-" + versionIndex.toString();
}

export function handlePersonVersionAdded(event: PersonVersionAdded): void {
	const personHash = event.params.personHash;
	const versionIndex = event.params.versionIndex;
	const addedBy = event.params.addedBy;
	const timestamp = event.params.timestamp;
	const fatherHash = event.params.fatherHash;
	const fatherVersionIndex = event.params.fatherVersionIndex;
	const motherHash = event.params.motherHash;
	const motherVersionIndex = event.params.motherVersionIndex;
	const tag = event.params.tag;

	// upsert Person
	const personId = makePersonId(personHash);
	let person = Person.load(personId);
	if (person == null) {
		person = new Person(personId);
		person.hash = personHash;
	}
	person.save();

	// upsert PersonVersion
	const pvId = makeVersionId(personHash, versionIndex);
	let pv = PersonVersion.load(pvId);
	if (pv == null) {
		pv = new PersonVersion(pvId);
	}
	pv.person = person.id;
	pv.personHash = personHash;
	pv.versionIndex = versionIndex;
	pv.addedBy = addedBy;
	pv.timestamp = timestamp;
	pv.tag = tag;
	// metadataCID is not in the event, can be filled later through contract binding data source

	// father linkage
	pv.fatherHash = fatherHash;
	pv.fatherVersionIndex = fatherVersionIndex;
	if (fatherHash.notEqual(Bytes.empty()) && fatherVersionIndex.gt(BigInt.zero())) {
		const fatherId = makeVersionId(fatherHash, fatherVersionIndex);
		pv.father = fatherId;
	}

	// mother linkage
	pv.motherHash = motherHash;
	pv.motherVersionIndex = motherVersionIndex;
	if (motherHash.notEqual(Bytes.empty()) && motherVersionIndex.gt(BigInt.zero())) {
		const motherId = makeVersionId(motherHash, motherVersionIndex);
		pv.mother = motherId;
	}

	pv.save();

	// create ParentChildEdge for father
	if (pv.father != null) {
		const edgeId = pv.father!.toString() + "->" + pv.id;
		let edge = ParentChildEdge.load(edgeId);
		if (edge == null) {
			edge = new ParentChildEdge(edgeId);
		}
		edge.relation = "father";
		edge.parent = pv.father!;
		edge.child = pv.id;
		edge.fatherVersion = pv.father!;
		edge.motherVersion = null;
		edge.save();
	}

	// create ParentChildEdge for mother
	if (pv.mother != null) {
		const edgeId = pv.mother!.toString() + "->" + pv.id;
		let edge = ParentChildEdge.load(edgeId);
		if (edge == null) {
			edge = new ParentChildEdge(edgeId);
		}
		edge.relation = "mother";
		edge.parent = pv.mother!;
		edge.child = pv.id;
		edge.fatherVersion = null;
		edge.motherVersion = pv.mother!;
		edge.save();
	}
}
