import argparse,json
from .parser import CoreParser
from .vendor.engine import GrammarError

def main():
    cli=argparse.ArgumentParser(description='Telugu core parser; outcomes are relative to the registered model.')
    cli.add_argument('--no-benchmark-lexicon',action='store_true')
    sub=cli.add_subparsers(dest='command',required=True)
    a=sub.add_parser('analyze');a.add_argument('word');a.add_argument('--trace',action='store_true')
    g=sub.add_parser('generate');g.add_argument('base');g.add_argument('modifiers',nargs='*')
    s=sub.add_parser('search');s.add_argument('--modifier');s.add_argument('--base');s.add_argument('--core',type=int,choices=[1,2,3]);s.add_argument('--limit',type=int,default=20);s.add_argument('--include-ambiguous',action='store_true')
    s.add_argument('--include-shared',action='store_true',help='Include reviewed shared forms with grouped progression requirements')
    c=sub.add_parser('contrast');c.add_argument('word');c.add_argument('axis');c.add_argument('value');c.add_argument('--scope',choices=['base','result'],default='base');c.add_argument('--limit',type=int,default=50)
    n=sub.add_parser('neighbors');n.add_argument('word');n.add_argument('--scope',choices=['base','combined','chain'],default='combined');n.add_argument('--limit',type=int,default=50);n.add_argument('--max-distance',type=int,default=1);n.add_argument('--min-distance',type=int,default=0)
    n=sub.add_parser('neighbors-chain');n.add_argument('modifiers',nargs='+');n.add_argument('--limit',type=int,default=50);n.add_argument('--max-distance',type=int,default=1);n.add_argument('--min-distance',type=int,default=0)
    sub.add_parser('features')
    args=cli.parse_args();p=CoreParser(not args.no_benchmark_lexicon)
    try:
        if args.command=='analyze':result=p.analyze(args.word,args.trace)
        elif args.command=='generate':result=p.generate(args.base,args.modifiers)
        elif args.command=='contrast':result=p.contrast(args.word,args.axis,args.value,args.scope,args.limit)
        elif args.command=='neighbors':result=p.neighbors(args.word,scope=args.scope,limit=args.limit,max_distance=args.max_distance,min_distance=args.min_distance)
        elif args.command=='neighbors-chain':result=p.neighbors(chain=args.modifiers,limit=args.limit,max_distance=args.max_distance,min_distance=args.min_distance)
        elif args.command=='features':result=p.feature_model.inventory()
        else:result=p.search(args.modifier,args.base,args.core,not args.include_ambiguous,args.limit,args.include_shared)
    except GrammarError as e:result={'status':'unresolved','reason':e.code,'detail':e.detail}
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
