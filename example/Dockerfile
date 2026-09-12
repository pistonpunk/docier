# Build context is the REPOSITORY ROOT, not example/:
#   docker build -f example/Dockerfile -t docier-demo .
# The demo is compiled against ../src, so the library source has to be in scope.

FROM node:22-bookworm-slim AS build

# The engine's default measurer carries DejaVu's metrics, so DejaVu is the only family whose
# ascent/descent/lineGap agree with the face id the layout records. fonts-dejavu-extra carries the
# oblique and bold-oblique faces, which fonts-dejavu-core does not.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-dejavu-extra \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY fixtures ./fixtures
COPY example ./example

WORKDIR /repo/example
RUN npm ci

ENV DOCIER_FONT_DIR=/usr/share/fonts/truetype/dejavu
RUN npm run build


FROM nginx:1.29-alpine AS serve

# The stock table maps `docx` to an empty type and has no `ttf` entry. Append into the existing
# types block rather than adding a `types` directive to the server, which would replace the table.
RUN sed -i -e '/^[[:space:]]*docx;[[:space:]]*$/d' \
           -e 's|^}$|    application/vnd.openxmlformats-officedocument.wordprocessingml.document docx;\n    font/ttf ttf;\n}|' \
           /etc/nginx/mime.types \
    && grep -E "docx|ttf" /etc/nginx/mime.types

COPY example/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/example/dist /usr/share/nginx/html

EXPOSE 80
