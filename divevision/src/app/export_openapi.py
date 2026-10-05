"""Write the API's OpenAPI schema to `client/openapi.json`.

The Expo client generates its typed API client from that file (see
`client/README.md`), and `test_openapi_snapshot_is_current` fails when the
committed copy drifts from the app. Regenerate both with
`npm run api:update` in `client/`, or just the schema with:

    poetry run python -m divevision.src.app.export_openapi [path]
"""

import json
import sys
from pathlib import Path

from divevision.src.app.main import app

DEFAULT_PATH = Path(__file__).resolve().parents[3] / "client" / "openapi.json"


def render_schema() -> str:
    return json.dumps(app.openapi(), indent=2) + "\n"


def main(argv: list[str]) -> None:
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_PATH
    path.write_text(render_schema())


if __name__ == "__main__":
    main(sys.argv)
