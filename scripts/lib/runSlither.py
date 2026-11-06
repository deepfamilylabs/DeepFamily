"""Analyze explicit current Hardhat build-info without project auto-detection or compilation."""

import inspect
import json
import os
import sys
from importlib.metadata import version
from pathlib import Path

from crytic_compile import CryticCompile
from crytic_compile.platform.hardhat import Hardhat
from slither import Slither
from slither.detectors import all_detectors
from slither.detectors.abstract_detector import AbstractDetector


def main():
    root, artifacts, report_path = map(Path, sys.argv[1:])
    if version("slither-analyzer") != "0.11.6" or version("crytic-compile") != "0.4.2":
        raise RuntimeError("Install the pinned security/slither-requirements.txt environment")

    # Passing the platform instance bypasses compile_all's project auto-detection, which
    # does not recognize hardhat.config.mjs and otherwise silently analyzes zero contracts.
    compilation = CryticCompile(
        Hardhat(str(root)),
        ignore_compile=True,
        hardhat_artifacts_directory=str(artifacts),
        npx_disable=True,
    )
    analyzer = Slither(
        compilation,
        disallow_partial=True,
        exclude_dependencies=True,
        filter_paths=["(^|/)contracts/test/"],
        triage_database=str(artifacts / "unused-triage.json"),
    )
    # The committed exact-ID baseline is the only triage input for this CI gate.
    analyzer.sarif_input = str(artifacts / "unused.sarif")
    analyzer.sarif_triage = str(artifacts / "unused.sarif.triage")
    analyzed_sources = sorted(
        {
            os.path.relpath(contract.source_mapping.filename.absolute, root).replace(os.sep, "/")
            for contract in analyzer.contracts
        }
    )
    if not analyzer.contracts:
        raise RuntimeError("Slither analyzed zero contracts")

    # Slither 0.11.6 builds this cached query with list(set(IR objects)). The
    # incorrect-return detector picks its first RETURN, so process address order
    # can otherwise change an exact finding ID. Preserve every operation while
    # ordering that public query by source position before any detector runs.
    for contract in analyzer.contracts:
        for function in contract.functions_and_modifiers_declared:
            function.all_solidity_calls().sort(
                key=lambda operation: (
                    str(operation.node.source_mapping.filename.absolute),
                    operation.node.source_mapping.start,
                    operation.node.source_mapping.length,
                    str(operation),
                )
            )

    detectors = [
        detector
        for _, detector in inspect.getmembers(all_detectors, inspect.isclass)
        if issubclass(detector, AbstractDetector) and not inspect.isabstract(detector)
    ]
    if len(detectors) != 102:
        raise RuntimeError("The pinned Slither detector catalog changed")
    for detector in detectors:
        analyzer.register_detector(detector)
    findings = [finding for result in analyzer.run_detectors() for finding in result]
    report = {
        "success": True,
        "error": None,
        "results": {"detectors": findings},
        "analysis": {
            "contracts": len(analyzer.contracts),
            "detectors": len(detectors),
            "hashSeed": os.environ.get("PYTHONHASHSEED"),
            "callOrder": "source-position-v1",
            "sources": analyzed_sources,
        },
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if len(sys.argv) == 4:
            Path(sys.argv[3]).write_text(
                json.dumps({"success": False, "error": str(error), "results": {}}, indent=2)
                + "\n",
                encoding="utf-8",
            )
        raise
