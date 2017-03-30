'use strict';

var expect = require('chai').expect;
var AuditStream = require('../../lib/audit-tools/audit-stream');
var ProofStream = require('../../lib/audit-tools/proof-stream');
var utils = require('../../lib/utils');
var sinon = require('sinon');

describe('Proof', function() {

  const CHALLENGE = new Buffer('d3ccb55d5c9bd56606bca0187ecf28699cb674fb7e243' +
                               'fb4f180078735181686', 'hex');
  const SHARD = new Buffer('testshard');

  describe('@constructor', function() {

    it('should create instance without the new keyword', function() {
      expect(ProofStream([], CHALLENGE)).to.be.instanceOf(ProofStream);
    });

  });

  describe('#_generateLeaves', function() {

    it('should append empty bottom leaves to the power of two', function() {
      var audit = new AuditStream(12);
      audit.end(SHARD);
      setImmediate(function() {
        var proof = new ProofStream(audit.getPublicRecord(), CHALLENGE);
        var leaves = proof._generateLeaves(Array(12));
        expect(leaves.length).to.equal(16);
        leaves.splice(12).forEach(function(leaf) {
          expect(leaf).to.equal(utils.rmd160sha256b(''));
        });
      });
    });

  });

  describe('#_flush', function() {

    it('should emit an error if generate proof fails', function(done) {
      var proof = ProofStream([], CHALLENGE);
      var _generateProof = sinon.stub(proof, '_generateProof').throws(
        new Error('Failed')
      );
      proof._flush(function(err) {
        _generateProof.restore();
        expect(err.message).to.equal('Failed');
        done();
      });
    });

  });

  describe('#getProofResult', function() {

    it('should create a recursive tuple structure with leaves', function(done) {
      var audit = new AuditStream(12);
      audit.end(SHARD);
      setImmediate(function() {
        var challenge = audit.getPrivateRecord().challenges[1];
        var proof = new ProofStream(audit.getPublicRecord(), challenge);

        proof.end(SHARD);
        setImmediate(function() {
          expect(
            JSON.stringify(audit._tree.level(4))
          ).to.equal(
            JSON.stringify(proof._tree.level(4))
          );

          expect(
            JSON.stringify(audit._tree.level(3))
          ).to.equal(
            JSON.stringify(proof._tree.level(3))
          );

          expect(
            JSON.stringify(audit._tree.level(2))
          ).to.equal(
            JSON.stringify(proof._tree.level(2))
          );

          expect(
            JSON.stringify(audit._tree.level(1))
          ).to.equal(
            JSON.stringify(proof._tree.level(1))
          );

          expect(
            JSON.stringify(audit._tree.level(0))
          ).to.equal(
            JSON.stringify(proof._tree.level(0))
          );

          function _getChallengeResponse(data) {
            if (data.length === 1) {
              return utils.rmd160sha256b(data[0]);
            }

            if (Array.isArray(data[0])) {
              return _getChallengeResponse(data[0]);
            } else {
              return _getChallengeResponse(data[1]);
            }
          }

          var result = proof.getProofResult();

          expect(result).to.have.lengthOf(2);
          expect(_getChallengeResponse(result)).to.eql(
            utils.rmd160sha256b(utils.rmd160sha256b(
              Buffer.concat([Buffer.from(challenge, 'hex'), SHARD])
          ))
          );
          done();
        });
      });
    });

  });

});
