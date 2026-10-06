"""Real OS limits and supervised child restart, using a small deterministic parser."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

MODULE=Path(__file__).resolve().parents[2]/'data-transform/scripts/parse-core/live.py'
spec=importlib.util.spec_from_file_location('guard_live',MODULE)
live=importlib.util.module_from_spec(spec);spec.loader.exec_module(live)

@unittest.skipUnless(sys.platform=='linux','Production resource isolation uses Linux')
class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        root=Path(self.tmp.name)
        (root/'graph.json').write_text(json.dumps({'nodes':{'A':{'kind':'vocabulary','forms':['అ']}},'original_to_selectable':{'VOC:a':'A'}}))
        script=f'''
import importlib.util,sys,time,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('child_live',{str(MODULE)!r})
live=importlib.util.module_from_spec(spec);spec.loader.exec_module(live)
live.HERE=Path({str(root)!r})
class Parser:
    def __init__(self):self.index={{}};self._productive_cache={{}}
    def analyze(self,word):
        if word=='memory':block=bytearray(256*1024*1024)
        if word=='slow':time.sleep(10)
        if word=='exit':os._exit(7)
        if word=='partial':
            sys.stdout.write('{{');sys.stdout.flush();time.sleep(10)
        return {{'separation':'resolved_in_model','analyses':[],'vocabulary_expression_matches':[{{'id':'a'}}]}}
live.CoreParser=Parser
live.parser_child()
'''
        self.env=patch.dict(os.environ,{'GRAMMAR_PARSE_MEMORY_MB':'64'});self.env.start()
        self.guard=live.GuardedParser([sys.executable,'-c',script],word_timeout_ms=150,startup_timeout_ms=5000)
    def tearDown(self):self.guard.close();self.env.stop();self.tmp.cleanup()
    def assert_restarts(self,word,reason):
        old=self.guard.process
        start=time.monotonic();result=self.guard.parse(word)
        self.assertEqual(result['status'],'resource_limit')
        self.assertEqual(result['reason'],reason)
        self.assertEqual(result['targets'],[])
        self.assertLess(time.monotonic()-start,3)
        self.assertIsNotNone(old.poll(),'failed child must be reaped before replacement')
        self.assertIsNone(self.guard.process)
        self.assertEqual(self.guard.parse('అ'),{'status':'parsed','targets':['A']})
        self.assertNotEqual(old.pid,self.guard.process.pid)
    def test_memory_limit_then_next_word(self):self.assert_restarts('memory','memory-limit')
    def test_time_limit_then_next_word(self):self.assert_restarts('slow','time-limit')
    def test_partial_reply_cannot_block_watchdog(self):self.assert_restarts('partial','time-limit')
    def test_unexpected_exit_is_not_claimed_as_oom(self):self.assert_restarts('exit','worker-interrupted')
    def test_successful_words_reuse_one_index_process(self):
        pid=self.guard.process.pid
        for _ in range(4):self.assertEqual(self.guard.parse('అ')['status'],'parsed')
        self.assertEqual(self.guard.process.pid,pid)
    def test_startup_failure_is_not_a_word_result(self):
        with self.assertRaises(RuntimeError):
            live.GuardedParser([sys.executable,'-c','print("{}")'],startup_timeout_ms=1000)

if __name__=='__main__':unittest.main()
