# Build the paper: make        Clean: make clean
flow.pdf: flow.tex refs.bib
	pdflatex -interaction=nonstopmode -halt-on-error flow.tex
	bibtex flow
	pdflatex -interaction=nonstopmode -halt-on-error flow.tex
	pdflatex -interaction=nonstopmode -halt-on-error flow.tex

.PHONY: arxiv clean
clean:
	rm -f flow.aux flow.bbl flow.blg flow.log flow.out

arxiv:
	$(MAKE) -B flow.pdf
	tar czf flow-arxiv.tar.gz flow.tex flow.bbl refs.bib
