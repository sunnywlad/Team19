Ce que c'est : les deux tests du constat M4 écrits avant le correctif : ils échouent, approve versait un placement devenu non plaçable.
Commande : `forge test --match-test test_M4`

```text
[FAIL: approve ne doit pas verser le placement: 40000000000000000 != 100000000000000000] test_M4_placementHausseReserve_refuseSansPaiement() (gas: 809208)
[FAIL: approve ne doit pas verser le placement: 40000000000000000 != 100000000000000000] test_M4_placementNouvelleFacture_refuseSansPaiement() (gas: 880001)
Suite result: FAILED. 0 passed; 2 failed; 0 skipped; finished in 6.09ms (4.37ms CPU time)
Failing tests:
Encountered 2 failing tests in test/ArgentVault.t.sol:ArgentVaultCase1AndPauseTest
[FAIL: approve ne doit pas verser le placement: 40000000000000000 != 100000000000000000] test_M4_placementHausseReserve_refuseSansPaiement() (gas: 809208)
[FAIL: approve ne doit pas verser le placement: 40000000000000000 != 100000000000000000] test_M4_placementNouvelleFacture_refuseSansPaiement() (gas: 880001)
Encountered a total of 2 failing tests, 0 tests succeeded
```
